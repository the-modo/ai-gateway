//! Semantic cache — similarity-matched response cache using local embeddings.
//!
//! Embeddings are computed with signed feature hashing (word unigrams/bigrams +
//! character trigrams) into a fixed 256-dim vector, L2-normalised so cosine
//! similarity reduces to a dot product. No model downloads, no inference
//! runtime — embedding a prompt costs microseconds.
//!
//! Matching is *context-scoped*: only the last user message is fuzzy-matched.
//! The model, all prior conversation messages, temperature and max_tokens are
//! hashed into a scope key that must match exactly, so a similar question asked
//! in a different conversation context can never return the wrong answer.

use std::collections::VecDeque;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use gateway_providers::ChatResponse;

pub const EMBED_DIM: usize = 256;

/* ─── Runtime settings ───────────────────────────────────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticCacheSettings {
    pub enabled: bool,
    /// Cosine similarity required for a hit (0.5 – 0.999).
    pub threshold: f32,
    pub ttl_seconds: u64,
    pub max_entries: usize,
}

impl Default for SemanticCacheSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            threshold: 0.85,
            ttl_seconds: 3600,
            max_entries: 10_000,
        }
    }
}

/* ─── Embedding ──────────────────────────────────────────────────────────── */

const STOPWORDS: &[&str] = &[
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from",
    "has", "have", "i", "in", "is", "it", "its", "of", "on", "or", "s",
    "that", "the", "their", "them", "then", "there", "these", "they", "this",
    "to", "was", "we", "were", "will", "with", "you", "your",
];

fn is_stopword(w: &str) -> bool {
    STOPWORDS.binary_search(&w).is_ok()
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn add_feature(v: &mut [f32; EMBED_DIM], feature: &[u8], weight: f32) {
    let h = fnv1a64(feature);
    let idx = ((h >> 1) % EMBED_DIM as u64) as usize;
    let sign = if h & 1 == 1 { 1.0 } else { -1.0 };
    v[idx] += sign * weight;
}

/// Embed text into a unit-length 256-dim vector.
pub fn embed(text: &str) -> [f32; EMBED_DIM] {
    let mut v = [0f32; EMBED_DIM];
    let lower = text.to_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect();

    for (i, w) in words.iter().enumerate() {
        // Stopwords carry reduced — but non-zero — weight: they distinguish
        // "what is X" from "who is X" without dominating the vector.
        let weight = if is_stopword(w) { 0.3 } else { 2.0 };
        add_feature(&mut v, w.as_bytes(), weight);

        // Word bigrams capture local phrase structure.
        if i + 1 < words.len() {
            let mut bg = String::with_capacity(w.len() + words[i + 1].len() + 1);
            bg.push_str(w);
            bg.push(' ');
            bg.push_str(words[i + 1]);
            add_feature(&mut v, bg.as_bytes(), 0.35);
        }

        // Character trigrams give robustness to typos and inflections.
        if w.len() > 3 && !is_stopword(w) {
            let padded: Vec<char> = std::iter::once('\u{2}')
                .chain(w.chars())
                .chain(std::iter::once('\u{3}'))
                .collect();
            for win in padded.windows(3) {
                let s: String = win.iter().collect();
                add_feature(&mut v, s.as_bytes(), 0.55);
            }
        }
    }

    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for x in v.iter_mut() {
            *x /= norm;
        }
    }
    v
}

fn cosine(a: &[f32; EMBED_DIM], b: &[f32; EMBED_DIM]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

/* ─── Cache ──────────────────────────────────────────────────────────────── */

struct Entry {
    scope: u64,
    vec: [f32; EMBED_DIM],
    response: Arc<ChatResponse>,
    expires_at: Instant,
}

#[derive(Default)]
pub struct SemanticCache {
    entries: RwLock<VecDeque<Entry>>,
}

impl SemanticCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Best match within scope at or above the threshold.
    pub fn get(&self, scope: u64, text: &str, threshold: f32) -> Option<(Arc<ChatResponse>, f32)> {
        let query = embed(text);
        let now = Instant::now();
        let entries = self.entries.read().ok()?;

        let mut best: Option<(&Entry, f32)> = None;
        for e in entries.iter() {
            if e.scope != scope || e.expires_at <= now {
                continue;
            }
            let sim = cosine(&query, &e.vec);
            if sim >= threshold && best.map_or(true, |(_, b)| sim > b) {
                best = Some((e, sim));
            }
        }
        best.map(|(e, sim)| (Arc::clone(&e.response), sim))
    }

    pub fn insert(
        &self,
        scope: u64,
        text: &str,
        response: ChatResponse,
        ttl: Duration,
        max_entries: usize,
    ) {
        let vec = embed(text);
        let now = Instant::now();
        let Ok(mut entries) = self.entries.write() else { return };

        // Drop expired entries from the front (oldest-first ordering).
        while entries.front().is_some_and(|e| e.expires_at <= now) {
            entries.pop_front();
        }
        // Capacity eviction — oldest first.
        while entries.len() >= max_entries.max(1) {
            entries.pop_front();
        }
        entries.push_back(Entry {
            scope,
            vec,
            response: Arc::new(response),
            expires_at: now + ttl,
        });
    }

    pub fn len(&self) -> usize {
        self.entries.read().map(|e| e.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn clear(&self) {
        if let Ok(mut e) = self.entries.write() {
            e.clear();
        }
    }
}

/* ─── Tests ──────────────────────────────────────────────────────────────── */

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paraphrase_similarity_is_high() {
        let a = embed("What is the capital of France?");
        let b = embed("What's the capital of France");
        assert!(cosine(&a, &b) > 0.85, "got {}", cosine(&a, &b));
    }

    #[test]
    fn unrelated_similarity_is_low() {
        let a = embed("What is the capital of France?");
        let b = embed("Write a haiku about distributed databases");
        assert!(cosine(&a, &b) < 0.5, "got {}", cosine(&a, &b));
    }

    #[test]
    fn identical_is_one() {
        let a = embed("hello world");
        let b = embed("hello world");
        assert!((cosine(&a, &b) - 1.0).abs() < 1e-5);
    }
}

#[cfg(test)]
mod calibration {
    use super::*;

    fn sim(a: &str, b: &str) -> f32 {
        cosine(&embed(a), &embed(b))
    }

    /// The default threshold (0.85) must reject prompts whose meaning differs
    /// by a single swapped content word, with margin.
    #[test]
    fn meaning_changes_stay_below_default_threshold() {
        let pairs = [
            ("What is the capital of France?", "What is the capital of Germany?"),
            ("Write a python function to sort a list", "Write a python function to reverse a list"),
            ("How do I enable the cache?", "How do I disable the cache?"),
        ];
        for (a, b) in pairs {
            let s = sim(a, b);
            assert!(s < 0.85, "{s:.4} too high: «{a}» vs «{b}»");
        }
    }

    #[test]
    fn close_paraphrases_clear_default_threshold() {
        let pairs = [
            ("What is the capital of France?", "What's the capital of France"),
            ("What is the capital of France?", "what is the capital city of france"),
        ];
        for (a, b) in pairs {
            let s = sim(a, b);
            assert!(s >= 0.85, "{s:.4} too low: «{a}» vs «{b}»");
        }
    }
}
