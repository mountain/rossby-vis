//! Rossby-Vis: A visualization frontend for the Rossby data server
//!
//! This library provides a web server that embeds the Earth visualization frontend
//! and serves as a streaming proxy to Rossby NetCDF data servers.

pub mod embed;
pub mod error;
pub mod handlers;
pub mod logging;
pub mod middleware;
pub mod server;

pub use error::AppError;
pub use server::{run_server, AppState};
