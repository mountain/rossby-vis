use clap::Parser;
use rossby_vis::{
    logging::{init_logging, LogFormat, LoggingConfig},
    run_server,
};

#[derive(Parser, Debug)]
#[command(
    author,
    version,
    about = "Interactive visualization frontend for the rossby data server"
)]
struct Args {
    /// Port to run the server on
    #[arg(short, long, default_value_t = 8080)]
    port: u16,

    /// URL of the Rossby backend server
    #[arg(long, required = true)]
    api_url: String,

    /// Log level (trace, debug, info, warn, error)
    #[arg(long, default_value = "info")]
    log_level: String,

    /// Log format (text, json, compact)
    #[arg(long, default_value = "text")]
    log_format: String,

    /// Disable request tracing
    #[arg(long)]
    disable_request_tracing: bool,

    /// Disable system metrics collection
    #[arg(long)]
    disable_metrics: bool,

    /// Environment name (development, staging, production)
    #[arg(long, default_value = "development")]
    environment: String,

    /// Service name for logging and tracing
    #[arg(long, default_value = "rossby-vis")]
    service_name: String,

    /// Jaeger endpoint for distributed tracing
    #[arg(long)]
    jaeger_endpoint: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Parse command line arguments
    let args = Args::parse();

    // Create logging configuration
    let mut logging_config = LoggingConfig::from_env();

    // Override with command line arguments
    logging_config.level = args.log_level;
    logging_config.environment = args.environment;
    logging_config.service_name = args.service_name;
    logging_config.enable_request_tracing = !args.disable_request_tracing;
    logging_config.enable_metrics = !args.disable_metrics;

    if let Ok(format) = args.log_format.parse::<LogFormat>() {
        logging_config.format = format;
    }

    if let Some(endpoint) = args.jaeger_endpoint {
        logging_config.jaeger_endpoint = Some(endpoint);
        logging_config.enable_distributed_tracing = true;
    }

    // Initialize comprehensive logging system
    init_logging(logging_config)?;

    // Run the server
    run_server(args.port, args.api_url).await?;

    Ok(())
}
