mod embed;
mod error;
mod handlers;
mod server;

use clap::Parser;
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
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    fmt().with_env_filter(EnvFilter::from_default_env()).init();

    // Parse command line arguments
    let args = Args::parse();

    // Run the server
    server::run_server(args.port).await?;

    Ok(())
}
