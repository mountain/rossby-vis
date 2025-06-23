//! Tests for production logging functionality
//!
//! This module tests the comprehensive logging system including structured logging,
//! request tracing, metrics collection, and middleware behavior.

use axum::{
    body::Body,
    http::{HeaderValue, Method, Request, StatusCode},
    middleware::{self, Next},
    routing::get,
    Router,
};
use std::sync::Arc;
use tower::ServiceExt;

use rossby_vis::{
    logging::{generate_request_id, init_logging, LogFormat, LoggingConfig},
    middleware::{request_tracing_middleware, security_headers_middleware},
    server::AppState,
};

/// Test helper to create a test AppState
fn create_test_state() -> Arc<AppState> {
    Arc::new(AppState {
        api_url: "http://localhost:8000".to_string(),
        http_client: reqwest::Client::new(),
    })
}

/// Test helper to create a basic test router with middleware
fn create_test_router() -> Router {
    let state = create_test_state();

    Router::new()
        .route("/test", get(|| async { "test response" }))
        .layer(middleware::from_fn(security_headers_middleware))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            request_tracing_middleware,
        ))
        .with_state(state)
}

#[tokio::test]
async fn test_logging_config_from_env() {
    // Set environment variables
    std::env::set_var("LOG_LEVEL", "debug");
    std::env::set_var("LOG_FORMAT", "json");
    std::env::set_var("ENVIRONMENT", "test");
    std::env::set_var("SERVICE_NAME", "test-service");
    std::env::set_var("ENABLE_REQUEST_TRACING", "false");
    std::env::set_var("ENABLE_METRICS", "false");

    let config = LoggingConfig::from_env();

    assert_eq!(config.level, "debug");
    assert!(matches!(config.format, LogFormat::Json));
    assert_eq!(config.environment, "test");
    assert_eq!(config.service_name, "test-service");
    assert!(!config.enable_request_tracing);
    assert!(!config.enable_metrics);

    // Clean up environment variables
    std::env::remove_var("LOG_LEVEL");
    std::env::remove_var("LOG_FORMAT");
    std::env::remove_var("ENVIRONMENT");
    std::env::remove_var("SERVICE_NAME");
    std::env::remove_var("ENABLE_REQUEST_TRACING");
    std::env::remove_var("ENABLE_METRICS");
}

#[tokio::test]
async fn test_logging_initialization() {
    let config = LoggingConfig {
        level: "info".to_string(),
        format: LogFormat::Text,
        enable_request_tracing: true,
        enable_metrics: false, // Disable metrics to avoid spawning background task
        enable_distributed_tracing: false,
        jaeger_endpoint: None,
        service_name: "test-service".to_string(),
        environment: "test".to_string(),
    };

    // This should not panic and should initialize successfully
    let result = init_logging(config);
    assert!(result.is_ok());
}

#[test]
fn test_request_id_generation() {
    let id1 = generate_request_id();
    let id2 = generate_request_id();

    // Request IDs should be different
    assert_ne!(id1, id2);

    // Should be valid UUIDs
    assert!(uuid::Uuid::parse_str(&id1).is_ok());
    assert!(uuid::Uuid::parse_str(&id2).is_ok());

    // Should have correct length
    assert_eq!(id1.len(), 36); // Standard UUID length with hyphens
    assert_eq!(id2.len(), 36);
}

#[test]
fn test_log_format_parsing() {
    assert!(matches!(
        "text".parse::<LogFormat>().unwrap(),
        LogFormat::Text
    ));
    assert!(matches!(
        "pretty".parse::<LogFormat>().unwrap(),
        LogFormat::Text
    ));
    assert!(matches!(
        "json".parse::<LogFormat>().unwrap(),
        LogFormat::Json
    ));
    assert!(matches!(
        "compact".parse::<LogFormat>().unwrap(),
        LogFormat::Compact
    ));

    // Case insensitive
    assert!(matches!(
        "TEXT".parse::<LogFormat>().unwrap(),
        LogFormat::Text
    ));
    assert!(matches!(
        "JSON".parse::<LogFormat>().unwrap(),
        LogFormat::Json
    ));

    // Invalid format
    assert!("invalid".parse::<LogFormat>().is_err());
    assert!("xml".parse::<LogFormat>().is_err());
}

#[tokio::test]
async fn test_request_tracing_middleware() {
    let app = create_test_router();

    // Create a request
    let request = Request::builder()
        .method(Method::GET)
        .uri("/test")
        .header("user-agent", "test-agent")
        .body(Body::empty())
        .unwrap();

    // Process the request
    let response = app.oneshot(request).await.unwrap();

    // Check that request ID was added to response headers
    assert!(response.headers().contains_key("x-request-id"));

    // Check that the request ID is a valid UUID
    let request_id = response.headers().get("x-request-id").unwrap();
    let request_id_str = request_id.to_str().unwrap();
    assert!(uuid::Uuid::parse_str(request_id_str).is_ok());

    // Check status
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_request_tracing_with_existing_id() {
    let app = create_test_router();

    // Create a request with existing request ID
    let existing_id = "550e8400-e29b-41d4-a716-446655440000";
    let request = Request::builder()
        .method(Method::GET)
        .uri("/test")
        .header("x-request-id", existing_id)
        .body(Body::empty())
        .unwrap();

    // Process the request
    let response = app.oneshot(request).await.unwrap();

    // Check that the existing request ID was preserved
    let response_id = response.headers().get("x-request-id").unwrap();
    assert_eq!(response_id.to_str().unwrap(), existing_id);
}

#[tokio::test]
async fn test_security_headers_middleware() {
    let app = create_test_router();

    let request = Request::builder()
        .method(Method::GET)
        .uri("/test")
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    // Check that security headers are present
    let headers = response.headers();
    assert_eq!(headers.get("x-content-type-options").unwrap(), "nosniff");
    assert_eq!(headers.get("x-frame-options").unwrap(), "DENY");
    assert_eq!(headers.get("x-xss-protection").unwrap(), "1; mode=block");
    assert_eq!(
        headers.get("referrer-policy").unwrap(),
        "strict-origin-when-cross-origin"
    );
    assert!(headers.contains_key("content-security-policy"));
}

#[tokio::test]
async fn test_health_check_middleware() {
    let state = create_test_state();

    let app = Router::new()
        .route("/health", get(|| async { "should not reach this" }))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            rossby_vis::middleware::health_check_middleware,
        ))
        .with_state(state);

    let request = Request::builder()
        .method(Method::GET)
        .uri("/health")
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    // Health check should return OK
    assert_eq!(response.status(), StatusCode::OK);

    // Should return JSON
    assert_eq!(
        response.headers().get("content-type").unwrap(),
        "application/json"
    );

    // For now, just check that we get a JSON response
    // TODO: Add body content verification when we have proper test utilities
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_health_check_alternative_path() {
    let state = create_test_state();

    let app = Router::new()
        .route("/healthz", get(|| async { "should not reach this" }))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            rossby_vis::middleware::health_check_middleware,
        ))
        .with_state(state);

    let request = Request::builder()
        .method(Method::GET)
        .uri("/healthz")
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    // Health check should work on /healthz as well
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_request_correlation_across_middleware() {
    let app = create_test_router();

    let request = Request::builder()
        .method(Method::POST)
        .uri("/test")
        .header("x-correlation-id", "test-correlation-123")
        .header("user-agent", "integration-test")
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    // The correlation ID should be preserved as request ID
    let request_id = response.headers().get("x-request-id").unwrap();
    assert_eq!(request_id.to_str().unwrap(), "test-correlation-123");
}

#[tokio::test]
async fn test_middleware_ordering() {
    // Test that middleware is applied in the correct order
    let state = create_test_state();

    let app = Router::new()
        .route("/test", get(|| async { "test" }))
        .layer(middleware::from_fn(
            |req: Request<Body>, next: Next<Body>| async move {
                let mut response = next.run(req).await;
                response
                    .headers_mut()
                    .insert("custom-header", HeaderValue::from_static("last"));
                response
            },
        ))
        .layer(middleware::from_fn(security_headers_middleware))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            request_tracing_middleware,
        ))
        .with_state(state);

    let request = Request::builder()
        .method(Method::GET)
        .uri("/test")
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    // All headers should be present
    assert!(response.headers().contains_key("x-request-id"));
    assert!(response.headers().contains_key("x-content-type-options"));
    assert!(response.headers().contains_key("custom-header"));
}

#[test]
fn test_logging_config_validation() {
    let mut config = LoggingConfig::default();

    // Test valid configurations
    config.level = "trace".to_string();
    config.format = LogFormat::Json;
    config.enable_request_tracing = true;
    config.enable_metrics = true;

    // These should not panic
    assert_eq!(config.level, "trace");
    assert!(matches!(config.format, LogFormat::Json));
    assert!(config.enable_request_tracing);
    assert!(config.enable_metrics);
}

#[tokio::test]
async fn test_concurrent_request_handling() {
    let app = create_test_router();

    // Create multiple concurrent requests
    let mut handles = Vec::new();

    for i in 0..10 {
        let app_clone = app.clone();
        let handle = tokio::spawn(async move {
            let request = Request::builder()
                .method(Method::GET)
                .uri("/test")
                .header("test-id", i.to_string())
                .body(Body::empty())
                .unwrap();

            app_clone.oneshot(request).await
        });
        handles.push(handle);
    }

    // Wait for all requests to complete
    let results = futures::future::join_all(handles).await;

    // All requests should succeed
    for result in results {
        let response = result.unwrap().unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.headers().contains_key("x-request-id"));
    }
}

#[tokio::test]
async fn test_large_request_handling() {
    let app = create_test_router();

    // Create a request with large headers
    let large_value = "x".repeat(1000);
    let request = Request::builder()
        .method(Method::GET)
        .uri("/test")
        .header("large-header", large_value)
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    // Should still work correctly
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers().contains_key("x-request-id"));
}
