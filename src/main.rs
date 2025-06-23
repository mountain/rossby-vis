use clap::Parser;
use rossby_vis::run_server;
use tracing_subscriber::{fmt, EnvFilter};

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
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    fmt().with_env_filter(EnvFilter::from_default_env()).init();

    // Parse command line arguments
    let args = Args::parse();

    // Run the server
    run_server(args.port, args.api_url).await?;

    Ok(())
}
