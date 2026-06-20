pub mod error;
pub mod handlers;
pub mod mcp;
pub mod middleware;
pub mod router;
pub mod state;
pub mod updates;
pub mod marketing;

pub use router::build as build_app;
pub use state::AppState;
