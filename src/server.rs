use axum::{middleware as axum_middleware, routing::get, Router};
use std::{net::SocketAddr, sync::Arc};
use tower_http::trace::TraceLayer;
use tracing::info;

use crate::{
    handlers::{
        earth_dynamic_data, earth_temp_data, earth_wind_data, index, proxy_data, proxy_metadata,
        static_asset,
    },
    middleware::{
        error_logging_middleware, health_check_middleware, request_tracing_middleware,
        security_headers_middleware,
    },
};

/// Application state shared across all handlers
#[derive(Clone)]
pub struct AppState {
    pub api_url: String,
    pub http_client: reqwest::Client,
}

/// Run the web server on the specified port with the given API URL
pub async fn run_server(
    port: u16,
    api_url: String,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Create HTTP client for backend requests
    let http_client = reqwest::Client::new();

    // Create application state
    let state = Arc::new(AppState {
        api_url,
        http_client,
    });

    // Build our application with routes and middleware layers
    let app = Router::new()
        .route("/", get(index))
        .route("/proxy/metadata", get(proxy_metadata))
        .route("/proxy/data", get(proxy_data))
        // Earth frontend compatible routes for live Rossby data (MUST come before /*path)
        // Specific routes first (for backward compatibility)
        .route(
            "/data/weather/current/current-wind-surface-level-gfs-1.0.json",
            get(earth_wind_data),
        )
        .route(
            "/data/weather/current/current-temp-surface-level-gfs-1.0.json",
            get(earth_temp_data),
        )
        // Dynamic route for any variable discovered from metadata
        .route(
            "/data/weather/current/current-:variable-surface-level-gfs-1.0.json",
            get(earth_dynamic_data),
        )
        .route("/*path", get(static_asset))
        .layer(axum_middleware::from_fn_with_state(
            state.clone(),
            health_check_middleware,
        ))
        .layer(axum_middleware::from_fn(security_headers_middleware))
        .layer(axum_middleware::from_fn_with_state(
            state.clone(),
            error_logging_middleware,
        ))
        .layer(axum_middleware::from_fn_with_state(
            state.clone(),
            request_tracing_middleware,
        ))
        .layer(TraceLayer::new_for_http())
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
