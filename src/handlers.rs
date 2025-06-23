use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, Response as HttpResponse, StatusCode},
    response::{Html, IntoResponse, Response},
};
use futures::StreamExt;
use mime_guess::from_path;
use serde::Deserialize;
use std::{collections::HashMap, sync::Arc};
use tracing::{error, info, warn};

use crate::{embed::StaticAssets, error::AppError, server::AppState};

/// Query parameters for the data proxy endpoint
#[derive(Debug, Deserialize)]
pub struct DataQuery {
    /// Comma-separated list of variables to fetch
    vars: Option<String>,
    /// Time parameter for data selection
    time: Option<String>,
    /// Time range for data selection
    time_range: Option<String>,
    /// Any additional query parameters
    #[serde(flatten)]
    extra: HashMap<String, String>,
}

/// Handler for the root path - serves index.html
pub async fn index() -> Response {
    match StaticAssets::get("index.html") {
        Some(content) => match std::str::from_utf8(&content.data) {
            Ok(html) => Html(html.to_string()).into_response(),
            Err(_) => HttpResponse::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::from("Failed to decode index.html"))
                .unwrap()
                .into_response(),
        },
        None => HttpResponse::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("index.html not found"))
            .unwrap()
            .into_response(),
    }
}

/// Handler for other static assets
pub async fn static_asset(Path(path): Path<String>) -> Response {
    match StaticAssets::get(&path) {
        Some(content) => {
            let mime = from_path(&path).first_or_octet_stream();
            HttpResponse::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime.as_ref().to_string())
                .body(Body::from(content.data.to_vec()))
                .unwrap()
                .into_response()
        }
        None => HttpResponse::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::CONTENT_TYPE, "text/plain")
            .body(Body::from("Asset not found"))
            .unwrap()
            .into_response(),
    }
}

/// Handler for the metadata proxy endpoint
pub async fn proxy_metadata(State(state): State<Arc<AppState>>) -> Result<Response, AppError> {
    info!("Proxying metadata request to Rossby server");

    let metadata_url = format!("{}/metadata", state.api_url);

    match state.http_client.get(&metadata_url).send().await {
        Ok(response) => {
            if response.status().is_success() {
                // Get the response body as bytes and stream it
                match response.bytes().await {
                    Ok(body) => Ok(HttpResponse::builder()
                        .status(StatusCode::OK)
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(Body::from(body.to_vec()))
                        .unwrap()
                        .into_response()),
                    Err(e) => {
                        error!("Failed to read metadata response body: {}", e);
                        Err(AppError::ProxyError(
                            "Failed to read response body".to_string(),
                        ))
                    }
                }
            } else {
                warn!("Rossby server returned error status: {}", response.status());
                Err(AppError::ProxyError(format!(
                    "Backend server error: {}",
                    response.status()
                )))
            }
        }
        Err(e) => {
            error!("Failed to connect to Rossby server: {}", e);
            Err(AppError::ProxyError(
                "Failed to connect to backend server".to_string(),
            ))
        }
    }
}

/// Handler for the data proxy endpoint with streaming support
pub async fn proxy_data(
    State(state): State<Arc<AppState>>,
    Query(params): Query<DataQuery>,
) -> Result<Response, AppError> {
    info!("Proxying data request to Rossby server: {:?}", params);

    // Build the query string for the Rossby server
    let mut query_params = Vec::new();

    if let Some(vars) = &params.vars {
        query_params.push(format!("vars={}", vars));
    }

    if let Some(time) = &params.time {
        query_params.push(format!("time={}", time));
    }

    if let Some(time_range) = &params.time_range {
        query_params.push(format!("time_range={}", time_range));
    }

    // Always request JSON format for web frontend
    query_params.push("format=json".to_string());

    // Add any extra parameters
    for (key, value) in &params.extra {
        query_params.push(format!("{}={}", key, value));
    }

    let query_string = query_params.join("&");
    let data_url = format!("{}/data?{}", state.api_url, query_string);

    info!("Requesting data from: {}", data_url);

    match state.http_client.get(&data_url).send().await {
        Ok(response) => {
            if response.status().is_success() {
                // Stream the response using chunked transfer encoding
                let stream = response.bytes_stream().map(|result| {
                    result.map_err(|e| {
                        error!("Stream error: {}", e);
                        std::io::Error::other(e)
                    })
                });

                Ok(HttpResponse::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::TRANSFER_ENCODING, "chunked")
                    .body(Body::wrap_stream(stream))
                    .unwrap()
                    .into_response())
            } else {
                warn!("Rossby server returned error status: {}", response.status());
                Err(AppError::ProxyError(format!(
                    "Backend server error: {}",
                    response.status()
                )))
            }
        }
        Err(e) => {
            error!("Failed to connect to Rossby server: {}", e);
            Err(AppError::ProxyError(
                "Failed to connect to backend server".to_string(),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_index_handler() {
        // We can only test the handler if the embedded assets are available
        let response = index().await;

        // The status will depend on whether index.html exists in the embedded assets
        if StaticAssets::get("index.html").is_some() {
            assert_eq!(response.status(), StatusCode::OK);
        } else {
            assert_eq!(response.status(), StatusCode::NOT_FOUND);
        }
    }
}
