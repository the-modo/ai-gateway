use clap::Parser;

use gateway_eval::{EvalConfig, run};

#[derive(Parser, Debug)]
#[command(name = "gateway-eval", about = "Modo AI Gateway — performance benchmark CLI")]
struct Args {
    /// Path to write the JSON report. "-" prints to stdout.
    #[arg(long, default_value = "perf-report.json")]
    json: String,

    /// Path to write the markdown report. "-" prints to stdout.
    #[arg(long, default_value = "perf-report.md")]
    md: String,

    /// "default" (fast — ~30 s) or "marketing" (deeper — ~3-5 min).
    #[arg(long, default_value = "default")]
    sweep: String,

    /// Simulated upstream latency (ms). 0 = upstream zero-cost so the
    /// numbers reflect gateway overhead only.
    #[arg(long, default_value = "0")]
    mock_latency_ms: u64,
}

#[tokio::main(flavor = "multi_thread")]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    tracing_subscriber::fmt()
        .with_env_filter("warn,gateway_eval=info")
        .with_target(false)
        .try_init()
        .ok();

    let mut cfg = EvalConfig::default();
    cfg.mock_latency_ms = args.mock_latency_ms;
    cfg.scenarios = match args.sweep.as_str() {
        "marketing" => EvalConfig::marketing_sweep(),
        _ => EvalConfig::default_sweep(),
    };

    eprintln!("Running {} scenarios…", cfg.scenarios.len());
    let report = run(cfg).await?;

    let json = serde_json::to_string_pretty(&report)?;
    if args.json == "-" {
        println!("{json}");
    } else {
        std::fs::write(&args.json, &json)?;
        eprintln!("wrote {}", args.json);
    }

    let md = report.to_markdown();
    if args.md == "-" {
        println!("{md}");
    } else {
        std::fs::write(&args.md, &md)?;
        eprintln!("wrote {}", args.md);
    }

    // Print to stderr so it lands in CI logs too
    eprintln!("\n{md}");
    Ok(())
}
