# rossby-vis

[![Build Status](https://github.com/mountain/rossby-vis/actions/workflows/ci.yml/badge.svg)](https://github.com/mountain/rossby-vis/actions)
[![Crates.io](https://img.shields.io/crates/v/rossby-vis.svg)](https://crates.io/crates/rossby-vis)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A high-performance visualization frontend bridge between the Rossby NetCDF data server and Earth visualization interface, providing interactive global weather and oceanographic data exploration through streaming data architecture.

## Project Overview

`rossby-vis` serves as a standalone streaming data proxy that bridges the gap between NetCDF-based meteorological data servers and web-based visualization frontends. It embeds the Earth visualization interface as static assets while providing efficient, memory-safe access to large weather datasets.

### Key Features

- **Single Binary Distribution**: Embeds all frontend assets in a self-contained executable
- **Streaming Data Proxy**: Handles multi-gigabyte datasets without memory bloat using chunked transfer encoding
- **Unified API Integration**: Supports Rossby's modern `/data` endpoint with multi-variable requests
- **Format Translation**: Converts NetCDF metadata to web-friendly JSON formats transparently
- **Real-time Visualization**: Enables interactive exploration of meteorological and oceanographic data
- **Memory Efficient**: Constant memory usage regardless of dataset size through streaming architecture
- **Comprehensive Testing**: Unit and integration tests with CI/CD automation

## Development

### Prerequisites

- Rust (stable channel, 2021 edition or later)
- Cargo package manager

### Building

```bash
# Build the project
cargo build

# Build for production
cargo build --release
```

### Running

```bash
# Run the server on the default port (8080)
cargo run

# Run with a custom port
cargo run -- --port 9000
```

### Testing

```bash
# Run all tests
cargo test

# Run specific test suites
cargo test --test integration_tests
```

### CI Checks

The project uses GitHub Actions for CI/CD with the following checks:

- `cargo check`: Verifies the code compiles without errors
- `cargo test`: Runs all unit and integration tests
- `cargo fmt --check`: Ensures code formatting matches the Rust style guide
- `cargo clippy`: Runs the Rust linter to catch common issues

You can run these checks locally before committing:

```bash
cargo check
cargo test
cargo fmt --check
cargo clippy -- -D warnings
```

## System Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Web Browser   │◄──►│   rossby-vis     │◄──►│  Rossby Server  │
│                 │    │                  │    │                 │
│ Earth Frontend  │    │ • Static Assets  │    │ • NetCDF Data   │
│ • Visualization │    │ • Data Proxy     │    │ • Unified API   │
│ • User Controls │    │ • Format Convert │    │ • Time Series   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Core Components

1. **Static Asset Server**: Serves embedded Earth frontend (HTML, CSS, JavaScript)
2. **Data Proxy Layer**: Streams and transforms data between Rossby and Earth formats
3. **Format Converter**: Real-time NetCDF → JSON translation during streaming

## API Integration

### Rossby Server Requirements

The system integrates with Rossby's unified data endpoint:

```bash
# Multi-variable wind data request
GET /data?vars=u10,v10&time=1672531200&format=json

# Temperature data over time range
GET /data?vars=t2m&time_range=1672531200,1675209600&format=json
```

### Response Format
```json
{
  "metadata": {
    "shape": [1, 721, 1440],
    "dimensions": ["time", "latitude", "longitude"],
    "variables": {
      "u10": {"units": "m s**-1", "long_name": "10 metre U wind component"}
    }
  },
  "data": {
    "u10": [-4.76, -4.75, -4.73, ...]  // Flattened array, unpacked values
  }
}
```

## Supported Variables

### Meteorological Data
- **Wind**: u10/v10 (10m), u100/v100 (100m wind components)  
- **Temperature**: t2m (2m temperature), sst (sea surface temperature)
- **Pressure**: sp (surface pressure)
- **Humidity**: d2m (dewpoint temperature)
- **Precipitation**: sd (snow depth)
- **Radiation**: tisr (solar radiation)

### Oceanographic Data
- **Ocean Currents**: u/v current components
- **Sea Surface Temperature**: sst variable

## Usage

### Basic Server
```bash
# Start with default configuration
cargo run

# Custom port and backend server
cargo run -- --port 8080 --api-url http://localhost:8000
```

### Production Deployment
```bash
# Build optimized binary
cargo build --release

# Deploy single executable  
./target/release/rossby-vis --port 8080 --api-url https://rossby.example.com
```

## Development Plan

### ✅ Phase 1: Static Asset Foundation
- Single binary with embedded Earth frontend
- Basic web server with configurable port
- Static asset serving with proper MIME types

### 🚧 Phase 2: Streaming Data Proxy  
- HTTP streaming client integration
- Chunked transfer encoding for large datasets
- Real-time format conversion (Rossby → Earth)
- Multi-variable support for coordinated requests

### 📋 Phase 3: Advanced Features
- Enhanced temporal navigation
- Performance optimization and caching
- Extended error handling and monitoring

## Project Structure

- `src/`: Application source code
  - `main.rs`: Entry point with command line parsing
  - `server.rs`: Web server implementation using Axum
  - `handlers.rs`: Request handlers for static assets and data proxy
  - `embed.rs`: Configuration for embedding static assets
  - `error.rs`: Custom error types and handling
- `public/`: Earth frontend assets (embedded at build time)
- `tests/`: Integration tests for HTTP API and streaming
- `doc/`: Comprehensive system design and development documentation
- `.github/workflows/`: CI/CD configuration

## Documentation

- [`doc/design.md`](doc/design.md): Complete system architecture and technical design
- [`doc/plan.md`](doc/plan.md): Comprehensive project documentation and development guidelines
- [`AGENT.md`](AGENT.md): Development protocols and quality standards

## License

See the [LICENSE](LICENSE) file for details.
