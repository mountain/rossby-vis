//! Middleware for request tracing, logging, and observability
//!
//! This module provides middleware components for comprehensive request tracking,
//! structured logging, and performance monitoring.

use axum::{
    extract::State,
    http::{HeaderMap, HeaderValue, Request},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::{sync::Arc, time::Instant};
use tracing::{info_span, Instrument};

use crate::{log_request, logging::generate_request_id, server::AppState};

/// Request tracing middleware that adds correlation IDs and measures request duration
pub async fn request_tracing_middleware<B>(
    State(_state): State<Arc<AppState>>,
    mut request: Request<B>,
    next: Next<B>,
) -> Response {
    let start_time = Instant::now();
    let method = request.method().clone();
    let uri = request.uri().clone();
    let path = uri.path().to_string();

    // Generate or extract request ID
    let request_id = extract_or_generate_request_id(request.headers());

    // Add request ID to headers for downstream services
    request.headers_mut().insert(
        "x-request-id",
        HeaderValue::from_str(&request_id).unwrap_or_else(|_| HeaderValue::from_static("invalid")),
    );

    // Create tracing span with request context
    let span = info_span!(
        "http_request",
        http_method = %method,
        http_path = %path,
        http_scheme = uri.scheme_str(),
        http_host = uri.host(),
        request_id = %request_id,
        user_agent = extract_user_agent(request.headers()),
        remote_addr = extract_remote_addr(request.headers()),
    );

    // Process request within the span
    let response = async move {
        tracing::info!("Processing request");

        let mut response = next.run(request).await;

        // Add request ID to response headers
        response.headers_mut().insert(
            "x-request-id",
            HeaderValue::from_str(&request_id)
                .unwrap_or_else(|_| HeaderValue::from_static("invalid")),
        );

        let duration = start_time.elapsed();
        let status_code = response.status().as_u16();

        // Log structured request completion
        log_request!(
            method.as_str(),
            &path,
            status_code,
            duration.as_millis() as u64,
            &request_id
        );

        response
    }
    .instrument(span)
    .await;

    response
}

/// Extract or generate a request correlation ID
fn extract_or_generate_request_id(headers: &HeaderMap) -> String {
    // Try to extract existing request ID from various headers
    for header_name in ["x-request-id", "x-correlation-id", "x-trace-id"] {
        if let Some(header_value) = headers.get(header_name) {
            if let Ok(id) = header_value.to_str() {
                if !id.is_empty() {
                    return id.to_string();
                }
            }
        }
    }

    // Generate new request ID if none found
    generate_request_id()
}

/// Extract User-Agent header for logging
fn extract_user_agent(headers: &HeaderMap) -> Option<&str> {
    headers.get("user-agent").and_then(|v| v.to_str().ok())
}

/// Extract remote address from headers (considering proxy headers)
fn extract_remote_addr(headers: &HeaderMap) -> Option<&str> {
    // Try to get real IP from proxy headers first
    for header_name in ["x-forwarded-for", "x-real-ip", "cf-connecting-ip"] {
        if let Some(header_value) = headers.get(header_name) {
            if let Ok(ip) = header_value.to_str() {
                // For X-Forwarded-For, take the first IP
                if header_name == "x-forwarded-for" {
                    return ip.split(',').next().map(|s| s.trim());
                }
                return Some(ip);
            }
        }
    }
    None
}

/// Error handling middleware that logs errors with context
pub async fn error_logging_middleware<B>(
    State(_state): State<Arc<AppState>>,
    request: Request<B>,
    next: Next<B>,
) -> Response {
    let method = request.method().clone();
    let uri = request.uri().clone();
    let path = uri.path().to_string();

    let response = next.run(request).await;

    // Log error responses
    if response.status().is_client_error() || response.status().is_server_error() {
        tracing::warn!(
            target: "http_error",
            http_method = %method,
            http_path = %path,
            http_status_code = response.status().as_u16(),
            "HTTP error response"
        );
    }

    response
}

/// Security headers middleware
pub async fn security_headers_middleware<B>(request: Request<B>, next: Next<B>) -> Response {
    let mut response = next.run(request).await;

    let headers = response.headers_mut();

    // Add security headers
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert(
        "x-xss-protection",
        HeaderValue::from_static("1; mode=block"),
    );
    headers.insert(
        "referrer-policy",
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    headers.insert(
        "content-security-policy",
        HeaderValue::from_static("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:"),
    );

    response
}

/// Health check middleware that provides detailed status information
pub async fn health_check_middleware<B>(
    State(state): State<Arc<AppState>>,
    request: Request<B>,
    next: Next<B>,
) -> Response {
    // Only handle health check endpoints
    if request.uri().path() == "/health" || request.uri().path() == "/healthz" {
        use std::time::SystemTime;
        use sysinfo::{System, SystemExt};

        let mut sys = System::new();
        sys.refresh_system();

        let health_info = serde_json::json!({
            "status": "healthy",
            "timestamp": SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            "service": "rossby-vis",
            "version": env!("CARGO_PKG_VERSION"),
            "uptime_seconds": sys.uptime(),
            "memory": {
                "total_kb": sys.total_memory(),
                "used_kb": sys.used_memory(),
                "available_kb": sys.available_memory()
            },
            "backend": {
                "url": state.api_url,
                "status": "configured"
            }
        });

        return axum::Json(health_info).into_response();
    }

    next.run(request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue};

    #[test]
    fn test_extract_request_id() {
        let mut headers = HeaderMap::new();

        // Test with existing x-request-id
        headers.insert("x-request-id", HeaderValue::from_static("test-123"));
        let id = extract_or_generate_request_id(&headers);
        assert_eq!(id, "test-123");

        // Test with x-correlation-id
        headers.clear();
        headers.insert("x-correlation-id", HeaderValue::from_static("corr-456"));
        let id = extract_or_generate_request_id(&headers);
        assert_eq!(id, "corr-456");

        // Test without any headers (should generate new ID)
        headers.clear();
        let id = extract_or_generate_request_id(&headers);
        assert!(!id.is_empty());
        assert!(uuid::Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn test_extract_user_agent() {
        let mut headers = HeaderMap::new();

        headers.insert("user-agent", HeaderValue::from_static("Mozilla/5.0"));
        let ua = extract_user_agent(&headers);
        assert_eq!(ua, Some("Mozilla/5.0"));

        headers.clear();
        let ua = extract_user_agent(&headers);
        assert_eq!(ua, None);
    }

    #[test]
    fn test_extract_remote_addr() {
        let mut headers = HeaderMap::new();

        // Test X-Forwarded-For with multiple IPs
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("203.0.113.1, 198.51.100.1"),
        );
        let addr = extract_remote_addr(&headers);
        assert_eq!(addr, Some("203.0.113.1"));

        // Test X-Real-IP
        headers.clear();
        headers.insert("x-real-ip", HeaderValue::from_static("203.0.113.2"));
        let addr = extract_remote_addr(&headers);
        assert_eq!(addr, Some("203.0.113.2"));

        // Test no headers
        headers.clear();
        let addr = extract_remote_addr(&headers);
        assert_eq!(addr, None);
    }
}
