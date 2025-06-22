# rossby-vis

[![Build Status](https://github.com/mountain/rossby-vis/actions/workflows/ci.yml/badge.svg)](https://github.com/mountain/rossby-vis/actions)
[![Crates.io](https://img.shields.io/crates/v/rossby-vis.svg)](https://crates.io/crates/rossby-vis)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A visualization frontend for the Rossby data server, providing an interactive interface for visualizing global wind and weather patterns.

## Project Overview

This project serves as a standalone server for the Earth visualization interface, embedding all static assets in a single binary.

### Features

- Embeds all frontend assets in a single executable
- Serves HTML, CSS, JavaScript, and other assets from memory
- Provides a lightweight web server with configurable port
- Comprehensive test suite with unit and integration tests
- CI/CD integration with GitHub Actions

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

## Project Structure

- `src/`: Application source code
  - `main.rs`: Entry point with command line parsing
  - `server.rs`: Web server implementation using Axum
  - `handlers.rs`: Request handlers for serving static assets
  - `embed.rs`: Configuration for embedding static assets
  - `error.rs`: Custom error types
- `tests/`: Integration tests
- `.github/workflows/`: CI/CD configuration

## Phase 1 Implementation

The first phase implements a web server that:

1. Embeds all static assets from the `public/` directory into the binary
2. Serves these assets over HTTP at `http://localhost:<port>`
3. Delivers appropriate MIME types for each file
4. Provides proper error handling for missing assets

## License

See the [LICENSE](LICENSE) file for details.
