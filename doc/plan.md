# Rossby-Vis: Comprehensive Project Documentation

This document consolidates all project documentation for the `rossby-vis` visualization frontend.

## Table of Contents

1. [Project Overview](#project-overview)
2. [Development Guidelines](#development-guidelines)
3. [System Design](#system-design)
4. [Development Plan](#development-plan)
5. [Quick Start](#quick-start)

---

## Project Overview

### Mission Statement

`rossby-vis` serves as a visualization frontend bridge between the Rossby NetCDF data server and the Earth visualization interface, providing an interactive interface for visualizing global wind and weather patterns through a streaming data proxy architecture.

### Key Features

- **Single Binary Distribution**: Embeds all frontend assets in a self-contained executable
- **Streaming Data Proxy**: Handles large datasets without memory bloat using chunked transfer encoding
- **Format Translation**: Converts Rossby NetCDF metadata to Earth-compatible JSON formats
- **Real-time Visualization**: Enables interactive weather data exploration with temporal navigation
- **Minimal Frontend Changes**: Transparent integration requiring minimal Earth frontend modifications

### Problem Solved

The project addresses the fundamental incompatibility between:
- **Rossby Server**: Provides NetCDF-formatted meteorological data with comprehensive metadata
- **Earth Frontend**: Expects specific JSON structures optimized for web visualization

---

## Development Guidelines

### Core Engineering Principles

1. **Clarity over Cleverness**: Write maintainable, readable code
2. **Test Rigorously**: No feature is complete without comprehensive tests
3. **Automate Everything**: CI/CD pipelines handle formatting, linting, testing, deployment
4. **Document Diligently**: Self-documenting code with clear explanations

### Mandatory Code Quality Standards

#### Formatting & Linting
```bash
# Required before every commit
cargo fmt --check
cargo clippy -- -D warnings
cargo test
cargo doc --no-deps
```

#### Testing Protocol
- **Unit Tests**: Test individual functions in isolation with `#[cfg(test)]` modules
- **Integration Tests**: Full HTTP API lifecycle testing in `tests/` directory
- **Coverage Requirements**: All public methods, edge cases, error conditions

#### Error Handling
- Use `Result<T, E>` for all fallible operations
- **Forbidden**: `.unwrap()` or `.expect()` in application logic
- Custom error types using `thiserror` crate for structured error handling

#### Version Control
- **Conventional Commits**: `feat:`, `fix:`, `docs:`, `test:` prefixes
- **Feature Branches**: No direct commits to `main`
- **Pull Requests**: Must pass all CI checks before review

---

## System Design

### Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Web Browser   │◄──►│   rossby-vis     │◄──►│  Rossby Server  │
│                 │    │                  │    │                 │
│ Earth Frontend  │    │ • Static Assets  │    │ • NetCDF Data   │
│ • Visualization │    │ • Data Proxy     │    │ • Metadata API  │
│ • User Controls │    │ • Format Convert │    │ • Time Series   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Core Components

#### 1. Static Asset Server
- **Technology**: `rust-embed` for binary asset bundling
- **Purpose**: Serve Earth frontend files (HTML, CSS, JavaScript)
- **Routes**: `GET /` → `index.html`, `GET /*path` → Static assets

#### 2. Data Proxy Layer
- **Technology**: `reqwest` streams with `axum` response streaming
- **Purpose**: Transform and forward requests between Earth and Rossby
- **Routes**: 
  - `/proxy/metadata` → Transform Rossby metadata to Earth format
  - `/proxy/data?vars={variables}&time={timestamp}&format=json` → Stream data with format conversion
- **Conversion**: Transforms Rossby's unified JSON response into Earth's expected format

#### 3. Format Conversion Engine
- **Metadata Converter**: Rossby NetCDF → Earth JSON headers
- **Data Stream Processor**: Real-time array conversion during streaming
- **Grid Calculator**: Derive Earth-compatible spatial parameters

### Data Format Translation

#### Rossby Metadata Structure
```json
{
  "coordinates": {
    "latitude": [90.0, 89.75, ...],
    "longitude": [0.0, 0.25, ...],
    "time": [700464.0, 700465.0, ...]
  },
  "dimensions": {
    "latitude": {"size": 721},
    "longitude": {"size": 1440},
    "time": {"size": 24}
  },
  "variables": {
    "u10": {
      "attributes": {
        "long_name": "10 metre U wind component",
        "units": "m s**-1",
        "scale_factor": 0.0007641157819367142,
        "add_offset": 1.8308104355477524,
        "_FillValue": -32767.0
      }
    }
  }
}
```

#### Requirements for Rossby Server

The rossby-vis project expects the Rossby server to handle all NetCDF-specific processing including CF convention compliance (scale_factor, add_offset, _FillValue handling) and provide clean JSON APIs through a unified data endpoint.

**Unified Data Endpoint**: `GET /data?vars={variables}&format=json&{dimension_selectors}`

For web frontends like rossby-vis, the Rossby server provides a unified data endpoint that supports multiple variables and flexible dimension selection:

```bash
# Example request for wind components at specific time
GET /data?vars=u10,v10&time=1672531200&format=json

# Example request for temperature data over a time range
GET /data?vars=t2m&time_range=1672531200,1675209600&format=json
```

**Expected Response Format** (`format=json`):
```json
{
  "metadata": {
    "query": {
      "vars": "u10,v10",
      "time": "1672531200",
      "format": "json"
    },
    "shape": [1, 721, 1440],
    "dimensions": ["time", "latitude", "longitude"],
    "variables": {
      "u10": {
        "units": "m s**-1",
        "long_name": "10 metre U wind component"
      },
      "v10": {
        "units": "m s**-1", 
        "long_name": "10 metre V wind component"
      }
    }
  },
  "data": {
    "u10": [-4.76, -4.75, -4.73, ...],  // Flattened 1D array, unpacked values
    "v10": [-2.34, -2.33, -2.31, ...],  // Missing values as null
  }
}
```

**Key Features of the Unified Endpoint**:
- **Multiple Variables**: Request multiple variables in a single call (e.g., `vars=u10,v10` for wind)
- **Flexible Dimension Selection**: Support time slices, ranges, and spatial subsets
- **Streaming Architecture**: Uses chunked transfer encoding for large datasets
- **Web-Optimized**: `format=json` handles all CF convention unpacking server-side

This division ensures:
- **Rossby server**: Handles domain-specific meteorological data processing
- **rossby-vis**: Focuses on web serving and JSON format translation
- **Clear separation**: Between NetCDF expertise and web visualization

#### Earth Expected Format
```json
[{
  "header": {
    "nx": 360, "ny": 181,
    "lo1": 0, "la1": 90, "lo2": 359, "la2": -90,
    "dx": 1, "dy": 1,
    "parameterNumberName": "U-component_of_wind",
    "parameterUnit": "m.s-1",
    "refTime": "2014-01-31T00:00:00.000Z"
  },
  "data": [-4.76, -4.75, -4.73, ...]
}]
```

### Variable Support Capabilities

The design supports **all meteorological variables** available from Rossby server:

#### Supported Variable Types
1. **Scalar Fields** (single value per grid point):
   - **Temperature**: t2m (2m temperature), sst (sea surface temperature)
   - **Pressure**: sp (surface pressure)
   - **Humidity**: d2m (dewpoint temperature) 
   - **Precipitation**: sd (snow depth)
   - **Radiation**: tisr (solar radiation)

2. **Vector Fields** (direction + magnitude):
   - **Wind**: u10/v10 (10m wind), u100/v100 (100m wind)
   - **Ocean Currents**: u/v current components

#### Visualization Approach
- **Scalar Variables**: Rendered as color-coded contour maps (temperature, pressure, humidity)
- **Vector Variables**: Rendered as particle animations or arrow fields (wind, currents)

### UI Adaptation Strategy

#### Metadata Transformation Pipeline
```rust
fn transform_rossby_to_earth_header(rossby_meta: RossbyMetadata, variable: &str) -> EarthHeader {
    let var_attrs = &rossby_meta.variables[variable].attributes;
    
    EarthHeader {
        nx: rossby_meta.dimensions.longitude.size,
        ny: rossby_meta.dimensions.latitude.size,
        lo1: rossby_meta.coordinates.longitude[0],
        la1: rossby_meta.coordinates.latitude[0],
        dx: calculate_longitude_step(&rossby_meta.coordinates.longitude),
        dy: calculate_latitude_step(&rossby_meta.coordinates.latitude),
        parameterNumberName: var_attrs.long_name.clone(),
        parameterUnit: var_attrs.units.clone(),
        parameterCategory: map_variable_category(variable), // "Temperature", "Pressure", etc.
        refTime: convert_time_units(&rossby_meta.coordinates.time[0])
    }
}

fn map_variable_category(variable: &str) -> &str {
    match variable {
        "t2m" | "sst" => "Temperature",
        "sp" => "Pressure",
        "d2m" => "Humidity", 
        "u10" | "v10" | "u100" | "v100" => "Wind",
        "sd" => "Precipitation",
        "tisr" => "Radiation",
        _ => "General"
    }
}
```

#### Frontend Integration
- **Minimal Changes**: Update base URLs to proxy endpoints
- **Catalog Loading**: `/proxy/catalog` instead of static files
- **Data Requests**: `/proxy/data?vars={variables}&time={timestamp}&format=json` routing
- **Multi-Variable Support**: Single requests can fetch multiple variables (e.g., u10,v10 for wind)
- **Transparent Operation**: Existing Earth code remains functional with format conversion

---

## Development Plan

### Phase 1: Static Asset Foundation ✅
**Status**: Implemented

**Objectives**: Self-contained server with embedded frontend assets

**Key Components**:
- Rust binary with `rust-embed` integration
- Web server using `axum` framework
- Static asset serving with proper MIME types
- Command-line configuration (port selection)

**Acceptance Criteria**:
- Single executable with no external dependencies
- Earth frontend renders correctly from embedded assets
- Configurable port via CLI arguments

### Phase 2: Streaming Data Proxy
**Status**: Next Phase

**Objectives**: Efficient large dataset handling through streaming architecture with unified API support

**Key Components**:
- HTTP client with streaming support (`reqwest`)
- Unified proxy routes: `/proxy/data?vars={variables}&time={timestamp}&format=json`
- Chunked transfer encoding implementation
- Multi-variable format conversion during streaming
- Real-time Rossby JSON → Earth format translation

**Technical Requirements**:
- Memory-efficient processing of multi-gigabyte responses
- Support for Rossby's unified `/data` endpoint with multiple variables
- Real-time format conversion (Rossby unified JSON → Earth format)
- Coordinated multi-variable requests (e.g., u10,v10 for wind visualization)
- Error handling for network failures and data corruption
- Configurable backend server URL via `--api-url` parameter

**Acceptance Criteria**:
- Low memory footprint during large dataset transfers
- Chunked transfer encoding visible in browser network inspection
- Successful multi-variable data visualization from Rossby backend
- Single requests efficiently handle related variables (wind u/v components)
- Robust error handling and recovery for proxy operations

### Phase 3: UI Migration to Metadata-Driven Architecture
**Status**: Planning Phase

**Objectives**: Transform hardcoded UI components to dynamically adapt based on Rossby server metadata

#### Phase 3a: Dynamic UI Component Generation ✅
**Status**: COMPLETED

**Objectives**: Core infrastructure for metadata-driven UI

**Key Components Implemented**:
- ✅ **MetadataService**: Centralized loading and parsing of Rossby server metadata
- ✅ **VariableMapper**: Automatic variable discovery and categorization system  
- ✅ **UIGenerator**: Dynamic generation of UI controls from metadata
- ✅ **Configuration Integration**: Enhanced configuration system with metadata validation

**Technical Achievements**:
- ✅ Fetch and parse `/proxy/metadata` on application startup (5-862ms response time)
- ✅ Generate Height controls: "– – – – – – hPa Sfc" from actual pressure levels
- ✅ Generate Overlay controls: "None – Wind – d2m – sd – sp – sst – t2m – tisr" from server variables
- ✅ Graceful fallback to hardcoded values if metadata unavailable
- ✅ Maintain existing Earth frontend functionality during transition

**Validated Architecture**:
```javascript
// Successful variable detection and categorization (variables depend on specific datasets)
const detectedVariables = Object.keys(metadata.variables); // Dynamic based on dataset

// Dynamic UI generation patterns proven effective
function generateHeightControls(metadata) {
    const levels = extractLevelsFromMetadata(metadata);
    // Generates actual available atmospheric levels from any dataset
}

function generateOverlayControls(variables) {
    // Each discovered variable becomes clickable overlay option
}
```

**Performance Validation**:
- Metadata requests: 5-862ms range
- Dynamic UI generation: < 1 second startup overhead
- Server logs confirm efficient proxy operation
- Event binding resilience with retry mechanisms

#### Phase 3b: Metadata-Driven Controls Implementation ⏳
**Objectives**: Replace all hardcoded UI elements with metadata-driven equivalents

**Key Components**:
- **Date Controls**: Use actual time range from metadata.coordinates.time
- **Data Layer Display**: Show actual data source from metadata
- **Height Selection**: Dynamic level generation (surface, pressure levels, height levels)
- **Overlay Generation**: Variable-based overlay creation with proper categorization
- **Source Information**: Extract and display actual data source information

**Technical Requirements**:
- Variable mapping system (short names → display names → visualization types)
- Level detection and categorization (pressure, height, surface)
- Time range extraction and navigation control updates
- Smart defaults and configuration persistence

**Acceptance Criteria**:
- All UI controls reflect server metadata capabilities
- Date navigation uses actual available time points
- Height controls show only available levels from data
- Overlay controls generated from server variables
- Source information extracted from metadata

#### Phase 3c: Enhanced Variable Discovery ⏳
**Objectives**: Advanced features for metadata-driven visualization

**Key Components**:
- Automatic variable categorization (scalar vs vector)
- Smart overlay grouping (temperature, wind, pressure)
- Multi-variable relationship detection (u/v wind components)
- Enhanced visualization type selection
- Configuration validation against metadata

**Technical Requirements**:
- Variable analysis engine for automatic categorization
- Relationship detection between related variables
- Intelligent default selection based on available data
- Enhanced error handling for missing variables
- Dynamic visualization adaptation

**Acceptance Criteria**:
- System automatically detects wind vector components
- Related variables grouped intelligently in UI
- Appropriate default selections based on available data
- Robust error handling for metadata inconsistencies
- Enhanced user experience with smart suggestions

### Phase 4: Advanced Features (Future)
- Performance optimization and caching strategies
- Enhanced error reporting and diagnostics
- Advanced visualization modes
- Real-time data streaming enhancements
- Multi-server support and configuration management

---

## Quick Start

### Prerequisites
- Rust stable toolchain (2021 edition or later)
- Cargo package manager

### Development Setup
```bash
# Clone and build
git clone <repository-url>
cd rossby-vis
cargo build

# Run with default configuration
cargo run

# Run with custom port and backend
cargo run -- --port 9000 --api-url http://localhost:8000

# Run tests
cargo test

# Check code quality
cargo fmt --check
cargo clippy -- -D warnings
```

### Production Deployment
```bash
# Build optimized binary
cargo build --release

# Deploy single executable
./target/release/rossby-vis --port 8080 --api-url https://rossby.example.com
```

### CI/CD Integration
The project includes automated checks for:
- Code compilation (`cargo check`)
- Test suite execution (`cargo test`)
- Code formatting (`cargo fmt --check`)
- Linting compliance (`cargo clippy`)

### Project Structure
```
rossby-vis/
├── src/
│   ├── main.rs          # CLI and application entry point
│   ├── server.rs        # Axum web server implementation
│   ├── handlers.rs      # HTTP request handlers
│   ├── embed.rs         # Static asset embedding
│   └── error.rs         # Error type definitions
├── public/              # Earth frontend assets
├── tests/               # Integration test suite
├── doc/                 # Documentation
└── Cargo.toml          # Project configuration
```

---

## Contributing

1. **Fork and Branch**: Create feature branches from `main`
2. **Follow Guidelines**: Adhere to code quality standards
3. **Test Thoroughly**: Add unit and integration tests
4. **Document Changes**: Update relevant documentation
5. **Submit PR**: Ensure all CI checks pass

## License

See [LICENSE](../LICENSE) file for details.
