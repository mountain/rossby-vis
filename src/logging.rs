//! Production-ready logging configuration and utilities for rossby-vis
//!
//! This module provides structured logging, request tracing, metrics collection,
//! and observability features suitable for production deployments.

use tracing::info;
use tracing_subscriber::{
    fmt::{self, time::ChronoUtc},
    layer::SubscriberExt,
    util::SubscriberInitExt,
    EnvFilter, Layer, Registry,
};

/// Logging output format options
#[derive(Debug, Clone, Copy)]
pub enum LogFormat {
    /// Human-readable text format (development)
    Text,
    /// JSON format (production)
    Json,
    /// Compact text format
    Compact,
}

impl std::str::FromStr for LogFormat {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "text" | "pretty" => Ok(LogFormat::Text),
            "json" => Ok(LogFormat::Json),
            "compact" => Ok(LogFormat::Compact),
            _ => Err(format!(
                "Invalid log format: {}. Valid options: text, json, compact",
                s
            )),
        }
    }
}

/// Logging configuration for production deployment
#[derive(Debug, Clone)]
pub struct LoggingConfig {
    /// Log level filter (e.g., "info", "debug", "warn")
    pub level: String,
    /// Output format
    pub format: LogFormat,
    /// Enable request tracing with correlation IDs
    pub enable_request_tracing: bool,
    /// Enable system metrics logging
    pub enable_metrics: bool,
    /// Enable distributed tracing (Jaeger)
    pub enable_distributed_tracing: bool,
    /// Jaeger endpoint for distributed tracing
    pub jaeger_endpoint: Option<String>,
    /// Application name for tracing
    pub service_name: String,
    /// Environment name (development, staging, production)
    pub environment: String,
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            level: "info".to_string(),
            format: LogFormat::Text,
            enable_request_tracing: true,
            enable_metrics: true,
            enable_distributed_tracing: false,
            jaeger_endpoint: None,
            service_name: "rossby-vis".to_string(),
            environment: "development".to_string(),
        }
    }
}

impl LoggingConfig {
    /// Create logging configuration from environment variables
    pub fn from_env() -> Self {
        let mut config = Self::default();

        // Log level from RUST_LOG or LOG_LEVEL
        if let Ok(level) = std::env::var("RUST_LOG") {
            config.level = level;
        } else if let Ok(level) = std::env::var("LOG_LEVEL") {
            config.level = level;
        }

        // Log format from LOG_FORMAT
        if let Ok(format_str) = std::env::var("LOG_FORMAT") {
            if let Ok(format) = format_str.parse() {
                config.format = format;
            }
        }

        // Request tracing from ENABLE_REQUEST_TRACING
        if let Ok(enable) = std::env::var("ENABLE_REQUEST_TRACING") {
            config.enable_request_tracing = enable.parse().unwrap_or(true);
        }

        // System metrics from ENABLE_METRICS
        if let Ok(enable) = std::env::var("ENABLE_METRICS") {
            config.enable_metrics = enable.parse().unwrap_or(true);
        }

        // Distributed tracing from ENABLE_DISTRIBUTED_TRACING
        if let Ok(enable) = std::env::var("ENABLE_DISTRIBUTED_TRACING") {
            config.enable_distributed_tracing = enable.parse().unwrap_or(false);
        }

        // Jaeger endpoint from JAEGER_ENDPOINT
        if let Ok(endpoint) = std::env::var("JAEGER_ENDPOINT") {
            config.jaeger_endpoint = Some(endpoint);
            config.enable_distributed_tracing = true; // Auto-enable if endpoint is provided
        }

        // Service name from SERVICE_NAME
        if let Ok(name) = std::env::var("SERVICE_NAME") {
            config.service_name = name;
        }

        // Environment from ENVIRONMENT or DEPLOYMENT_ENV
        if let Ok(env) = std::env::var("ENVIRONMENT") {
            config.environment = env;
        } else if let Ok(env) = std::env::var("DEPLOYMENT_ENV") {
            config.environment = env;
        }

        config
    }
}

/// Initialize comprehensive logging system
pub fn init_logging(config: LoggingConfig) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Create base filter
    let filter = EnvFilter::try_new(&config.level).unwrap_or_else(|_| EnvFilter::new("info"));

    // Create registry
    let registry = Registry::default().with(filter);

    // Create main logging layer based on format
    let logging_layer = match config.format {
        LogFormat::Text => fmt::Layer::default()
            .with_timer(ChronoUtc::rfc_3339())
            .with_target(true)
            .with_thread_ids(true)
            .with_thread_names(true)
            .with_file(true)
            .with_line_number(true)
            .boxed(),
        LogFormat::Json => fmt::Layer::default()
            .json()
            .with_timer(ChronoUtc::rfc_3339())
            .with_target(true)
            .with_thread_ids(true)
            .with_thread_names(true)
            .with_file(true)
            .with_line_number(true)
            .boxed(),
        LogFormat::Compact => fmt::Layer::default()
            .compact()
            .with_timer(ChronoUtc::rfc_3339())
            .with_target(false)
            .boxed(),
    };

    #[cfg(feature = "distributed-tracing")]
    let mut layers = vec![logging_layer];
    #[cfg(not(feature = "distributed-tracing"))]
    let layers = vec![logging_layer];

    // Add distributed tracing layer if enabled
    #[cfg(feature = "distributed-tracing")]
    if config.enable_distributed_tracing {
        if let Some(endpoint) = &config.jaeger_endpoint {
            match setup_jaeger_tracing(&config.service_name, endpoint) {
                Ok(tracer) => {
                    let telemetry_layer = tracing_opentelemetry::layer().with_tracer(tracer);
                    layers.push(telemetry_layer.boxed());
                    info!(
                        "Distributed tracing enabled with Jaeger endpoint: {}",
                        endpoint
                    );
                }
                Err(e) => {
                    tracing::warn!("Failed to setup Jaeger tracing: {}", e);
                }
            }
        }
    }

    // Initialize the subscriber with all layers
    registry.with(layers).init();

    // Log startup information
    info!("Logging system initialized");
    info!("Service: {}", config.service_name);
    info!("Environment: {}", config.environment);
    info!("Log level: {}", config.level);
    info!("Log format: {:?}", config.format);
    info!("Request tracing: {}", config.enable_request_tracing);
    info!("System metrics: {}", config.enable_metrics);
    info!("Distributed tracing: {}", config.enable_distributed_tracing);

    // Start metrics collection if enabled
    if config.enable_metrics {
        tokio::spawn(async move {
            metrics_collector().await;
        });
    }

    Ok(())
}

/// Setup Jaeger distributed tracing
#[cfg(feature = "distributed-tracing")]
fn setup_jaeger_tracing(
    service_name: &str,
    endpoint: &str,
) -> Result<opentelemetry::sdk::trace::Tracer, opentelemetry::trace::TraceError> {
    opentelemetry_jaeger::new_agent_pipeline()
        .with_service_name(service_name)
        .with_endpoint(endpoint)
        .install_simple()
}

/// Collect and log system metrics periodically
async fn metrics_collector() {
    use std::time::Duration;
    use sysinfo::{CpuExt, PidExt, ProcessExt, System, SystemExt};

    let mut sys = System::new_all();
    let pid = sysinfo::get_current_pid().ok();

    loop {
        sys.refresh_all();

        // Log system metrics
        let total_memory = sys.total_memory();
        let used_memory = sys.used_memory();
        let memory_usage_percent = (used_memory as f64 / total_memory as f64) * 100.0;

        let cpu_usage = sys.global_cpu_info().cpu_usage();

        tracing::info!(
            target: "metrics",
            system_memory_total = total_memory,
            system_memory_used = used_memory,
            system_memory_usage_percent = memory_usage_percent,
            system_cpu_usage_percent = cpu_usage,
            "System metrics"
        );

        // Log process-specific metrics if available
        if let Some(pid) = pid {
            if let Some(process) = sys.process(pid) {
                tracing::info!(
                    target: "metrics",
                    process_pid = pid.as_u32(),
                    process_memory = process.memory(),
                    process_virtual_memory = process.virtual_memory(),
                    process_cpu_usage = process.cpu_usage(),
                    "Process metrics"
                );
            }
        }

        // Sleep for 30 seconds before next collection
        tokio::time::sleep(Duration::from_secs(30)).await;
    }
}

/// Create a request correlation ID for tracing
pub fn generate_request_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Structured logging macros for different event types
#[macro_export]
macro_rules! log_request {
    ($method:expr, $path:expr, $status:expr, $duration_ms:expr) => {
        tracing::info!(
            target: "request",
            http_method = $method,
            http_path = $path,
            http_status_code = $status,
            duration_ms = $duration_ms,
            "HTTP request completed"
        );
    };
    ($method:expr, $path:expr, $status:expr, $duration_ms:expr, $request_id:expr) => {
        tracing::info!(
            target: "request",
            http_method = $method,
            http_path = $path,
            http_status_code = $status,
            duration_ms = $duration_ms,
            request_id = $request_id,
            "HTTP request completed"
        );
    };
}

#[macro_export]
macro_rules! log_proxy_request {
    ($backend_url:expr, $status:expr, $duration_ms:expr, $bytes_transferred:expr) => {
        tracing::info!(
            target: "proxy",
            backend_url = $backend_url,
            backend_status_code = $status,
            duration_ms = $duration_ms,
            bytes_transferred = $bytes_transferred,
            "Proxy request completed"
        );
    };
}

#[macro_export]
macro_rules! log_error {
    ($error:expr, $context:expr) => {
        tracing::error!(
            target: "error",
            error = %$error,
            context = $context,
            "Application error occurred"
        );
    };
    ($error:expr, $context:expr, $request_id:expr) => {
        tracing::error!(
            target: "error",
            error = %$error,
            context = $context,
            request_id = $request_id,
            "Application error occurred"
        );
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_format_parsing() {
        assert!(matches!(
            "text".parse::<LogFormat>().unwrap(),
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
        assert!("invalid".parse::<LogFormat>().is_err());
    }

    #[test]
    fn test_logging_config_default() {
        let config = LoggingConfig::default();
        assert_eq!(config.level, "info");
        assert!(matches!(config.format, LogFormat::Text));
        assert!(config.enable_request_tracing);
        assert!(config.enable_metrics);
        assert!(!config.enable_distributed_tracing);
    }

    #[test]
    fn test_request_id_generation() {
        let id1 = generate_request_id();
        let id2 = generate_request_id();
        assert_ne!(id1, id2);
        assert!(id1.len() > 0);
        assert!(id2.len() > 0);
    }
}
