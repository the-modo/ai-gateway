FROM rust:1.82-slim AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release --bin ai-gateway && \
    cp target/release/ai-gateway /ai-gateway

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /ai-gateway /usr/local/bin/ai-gateway

EXPOSE 8080

ENV GATEWAY_CONFIG=/etc/gateway/gateway.toml

ENTRYPOINT ["ai-gateway"]
