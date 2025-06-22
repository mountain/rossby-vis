use axum::{routing::get, Router};
use std::net::SocketAddr;
use tracing::info;

use crate::handlers::{index, static_asset};

/// Run the web server on the specified port
pub async fn run_server(port: u16) -> Result<(), Box<dyn std::error::Error>> {
    // Build our application with routes
    let app = Router::new()
        .route("/", get(index))
        .route("/*path", get(static_asset));

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
