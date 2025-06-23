use axum::{routing::get, Router};
use std::{net::SocketAddr, sync::Arc};
use tracing::info;

use crate::handlers::{index, proxy_data, proxy_metadata, static_asset};

/// Application state shared across all handlers
#[derive(Clone)]
pub struct AppState {
    pub api_url: String,
    pub http_client: reqwest::Client,
}

/// Run the web server on the specified port with the given API URL
pub async fn run_server(port: u16, api_url: String) -> Result<(), Box<dyn std::error::Error>> {
    // Create HTTP client for backend requests
    let http_client = reqwest::Client::new();

    // Create application state
    let state = Arc::new(AppState {
        api_url,
        http_client,
    });

    // Build our application with routes
    let app = Router::new()
        .route("/", get(index))
        .route("/proxy/metadata", get(proxy_metadata))
        .route("/proxy/data", get(proxy_data))
        .route("/*path", get(static_asset))
        .with_state(state);

    // Run the server
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    info!("Server listening on http://{}", addr);
    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    // These tests would typically be integration tests
    // since they'd involve starting a server and making HTTP requests
    // We'll implement proper integration tests in the tests directory
}
