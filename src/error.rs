use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

/// Application errors
#[derive(Error, Debug)]
pub enum AppError {
    /// Error returned when the server encounters an IO error
    #[error("Server error: {0}")]
    ServerError(#[from] std::io::Error),

    /// Error returned when proxying requests to the backend server
    #[error("Proxy error: {0}")]
    ProxyError(String),

    /// Error returned when there's an issue with request parsing
    #[error("Request error: {0}")]
    RequestError(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, error_message) = match self {
            AppError::ServerError(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Server error: {}", e),
            ),
            AppError::ProxyError(msg) => (StatusCode::BAD_GATEWAY, format!("Proxy error: {}", msg)),
            AppError::RequestError(msg) => {
                (StatusCode::BAD_REQUEST, format!("Request error: {}", msg))
            }
        };

        let body = Json(json!({
            "error": error_message,
        }));

        (status, body).into_response()
    }
}
