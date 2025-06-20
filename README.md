# rossby-vis

**The stunning, interactive frontend of [`earth`](https://github.com/cambecc/earth), re-engineered into a standalone Rust application that connects to the [`rossby`](https://github.com/mountain/rossby) data server.**

[![Build Status](https://github.com/your-username/rossby-vis/actions/workflows/ci.yml/badge.svg)](https://github.com/your-username/rossby-vis/actions)
[![Crates.io](https://img.shields.io/crates/v/rossby-vis.svg)](https://crates.io/crates/rossby-vis)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

---

![rossby-vis screenshot](https://path-to-your/screenshot.png)

*A sample visualization of a NetCDF file, served by `rossby` and rendered by the `rossby-vis` application.*

## Vision

The `rossby` project liberates scientific data from static NetCDF files. `rossby-vis` gives that data a face.

This project packages the world-class, GPU-powered frontend of Cameron Beccario's `earth` project into a simple, self-contained Rust application. It's designed to be the perfect visual companion to the `rossby` data server.

The goal is to provide a single, installable command-line tool that instantly serves a beautiful, interactive interface for your `rossby` instance. No web servers to configure, no dependencies to manage. Just pure, elegant visualization.

## Features

- **Single Executable:** `rossby-vis` is a command-line application. Run it, and it handles everything.
- **No Web Dependencies:** End-users do not need `Node.js`, `npm`, or any other web tooling. Just the `rossby-vis` binary.
- **Stunning Visuals:** Fully leverages the proven rendering engine of the original `earth` project.
- **Decoupled Architecture:** Clearly separates the `rossby-vis` client from the `rossby` data server, allowing them to run independently.
- **Simple & Fast:** Installation via `cargo`. Launches in seconds.

## How It Works

`rossby-vis` is a Rust application that embeds a pre-built, modified version of the `earth` web client. When you run `rossby-vis`, it starts a lightweight, local web server that serves these embedded assets and automatically opens your browser.

1.  **The Data Engine (`rossby` server)**: A running instance of the `rossby` project. It loads a NetCDF file and serves its data via a high-performance API.
2.  **The Visualization App (`rossby-vis`)**: This project. A Rust executable that serves the pre-packaged web interface (HTML/CSS/JS) and tells it where to find the `rossby` server.

```

\+--------------------------------+
|         Your Browser           |
|  (Opened by `rossby-vis`)      |
\+--------------------------------+
^
| 2. JS fetches data from rossby server
|    (e.g., http://localhost:8000/v1/data)
|
\+--------------------------------+   +--------------------------------+
|  The rossby-vis App (Client)   |   |  The rossby Server (Backend)   |
|--------------------------------|   |--------------------------------|
| 1a. Serves embedded web assets.|   | 1b. Loads your NetCDF file.    |
| 1b. Tells browser the API URL. |   |     Serves data on port 8000.  |
\+--------------------------------+   +--------------------------------+

````

## Quick Start

This guide assumes you have a `rossby` server instance up and running.

### Prerequisite: Run the `rossby` Server

In a separate terminal, start the `rossby` server with your data file.
```sh
# Download and install rossby from its repository if you haven't already
# cargo install rossby

# Start the server
rossby your_data_file.nc --port 8000
````

Your data is now being served at `http://localhost:8000`.

### Running `rossby-vis`

In a new terminal, install and run the `rossby-vis` application.

```sh
# 1. Install rossby-vis from Crates.io
cargo install rossby-vis

# 2. Run it, pointing it to your rossby server's API
rossby-vis --api-url http://localhost:8000
```

This single command will start the local visualization server and open a new tab in your default browser. You will immediately see your NetCDF data rendered on the interactive globe.

## Contributing

Contributions are highly welcome\! While the end-user application is a Rust binary, development involves both Rust and web technologies (JavaScript, HTML, CSS).

Please feel free to open an issue or submit a pull request.

## Acknowledgements

`rossby-vis` would be impossible without two foundational open-source projects:

  - **[`earth`](https://github.com/cambecc/earth)** by **Cameron Beccario**, whose frontend source code is the basis for this entire visualization.
  - **[`rossby`](https://www.google.com/url?sa=E&source=gmail&q=https://github.com/mountain/rossby)** which provides the essential high-performance backend.

## License

This project is licensed under the MIT License.
