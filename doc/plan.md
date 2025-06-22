# Development Plan for `rossby-vis`

This document outlines the phased development plan for `rossby-vis`. The project will be built iteratively, starting with a foundational static web server and then layering on the core data proxy functionality.

## Phase 1: Foundational Setup - Static Asset Serving

**Objective:** To create a single, self-contained Rust executable that serves the static frontend assets (HTML, CSS, JS) of the `earth` project using `rust-embed`. This phase establishes the core application structure without any dynamic data handling.

### Key Tasks

-   `[ ]` **Initialize Project:** Set up a new Rust binary project using `cargo new rossby-vis`.
-   `[ ]` **Select Web Framework:** Choose and integrate a lightweight Rust web framework (e.g., `axum`, `actix-web`). `axum` is recommended for its simplicity and integration with `tokio`.
-   `[ ]` **Integrate `rust-embed`:**
    -   Add `rust-embed` to the `Cargo.toml` dependencies.
    -   Add the pre-built `earth` frontend assets (e.g., into a `static/` or `public/` directory).
    -   Create the struct that derives `Embed` to bundle the assets.
-   `[ ]` **Implement Asset Serving:**
    -   Create a primary route (`/`) that serves the `index.html` file from the embedded assets.
    -   Create a wildcard route (e.g., `/*path`) that serves other static assets (like CSS, JS, images) based on the request path.
    -   Ensure correct MIME types are set for responses (e.g., `text/html`, `text/css`, `application/javascript`).
-   `[ ]` **Add Basic Configuration:**
    -   Implement a command-line argument (e.g., using `clap`) to specify the serving host and port (e.g., `rossby-vis --port 8080`).

### Acceptance Criteria

-   ✅ The project compiles into a single executable file with no external file dependencies for the web UI.
-   ✅ Running `cargo run -- --port 8080` successfully starts the web server on `http://localhost:8080`.
-   ✅ Opening a web browser to the server's address correctly renders the static `earth` user interface.
-   ✅ All network requests for assets (CSS, JS) are successfully served from the embedded bundle.

---

## Phase 2: Data Integration - The Streaming Data Proxy

**Objective:** To implement a proxy within `rossby-vis` that efficiently forwards large JSON data requests from the client to the `rossby` backend server. This will use **Chunked Transfer Encoding** to stream the response, preventing high memory consumption and enabling visualization of large datasets.

### Key Tasks

-   `[ ]` **Enhance Configuration:**
    -   Add a mandatory command-line argument (`--api-url`) to specify the URL of the backend `rossby` server (e.g., `http://localhost:8000`).
-   `[ ]` **Implement Proxy Route:**
    -   Create a new API route in the web server (e.g., `/proxy/data/...`).
    -   This handler will receive requests from the frontend that are intended for the `rossby` server.
-   `[ ]` **Develop Streaming Logic:**
    -   Use an HTTP client library that supports streaming, like `reqwest`.
    -   When a request hits the proxy route, the handler will:
        1.  Construct the full target URL for the `rossby` server.
        2.  Make a request to the `rossby` server.
        3.  Obtain the response body as a stream (`reqwest::Response::bytes_stream`).
    -   Create a streaming response in the web framework (`axum` has excellent support for this) that pipes the byte stream from `reqwest` directly to the client. The framework will automatically handle the `Transfer-Encoding: chunked` header.
-   `[ ]` **Modify Frontend Client:**
    -   Adjust the JavaScript code in the embedded `earth` assets to make data requests to the new proxy endpoint (`/proxy/data/...`) instead of directly to the `rossby` server's URL.

### Acceptance Criteria

-   ✅ The application can be started with a command like `rossby-vis --port 8080 --api-url http://localhost:8000`.
-   ✅ The frontend successfully fetches and renders data from a large dataset served by a running `rossby` instance.
-   ✅ When inspecting the browser's network requests, the data response from the `rossby-vis` server shows `Transfer-Encoding: chunked`.
-   ✅ The `rossby-vis` application maintains a low and stable memory footprint, even when proxying a multi-gigabyte JSON response.