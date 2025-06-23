# Rossby-Vis: System Design Document (Revision 0)

* Version: Revision 0
* Date: 2025-06-23

## 1. Introduction & Motivation

The `rossby-vis` project serves as a visualization frontend bridge between the Rossby NetCDF data server and the Earth visualization interface. The primary challenge is that the Rossby server provides meteorological and oceanographic data in NetCDF format with comprehensive metadata, while the Earth frontend expects specific JSON structures optimized for web visualization.

### Problem Statement

1. **Format Incompatibility**: Rossby server outputs NetCDF-style metadata and data arrays, while Earth frontend requires specific JSON header formats with grid parameters and 1D data arrays.

2. **Large Dataset Handling**: Weather and ocean current datasets can be multi-gigabyte JSON responses that would cause memory issues if loaded entirely into memory.

3. **Real-time Visualization**: Users need to interact with current weather data and navigate through time series without significant delays.

### Solution Approach

`rossby-vis` implements a streaming data proxy that:
- Serves the Earth frontend as embedded static assets
- Transforms Rossby metadata into Earth-compatible formats
- Streams large dataset responses using chunked transfer encoding
- Provides efficient data conversion without high memory consumption

## 2. Guiding Principles

### Performance First
- **Streaming Architecture**: All data responses use chunked transfer encoding to prevent memory bloat
- **Zero-Copy Where Possible**: Minimize data transformations and memory allocations
- **Efficient Interpolation**: Leverage existing Earth frontend interpolation algorithms

### Minimal Frontend Changes
- **Transparent Proxy**: Earth frontend should require minimal modifications to work with Rossby data
- **API Compatibility**: Maintain familiar data access patterns from Earth's original design
- **Progressive Enhancement**: Add Rossby capabilities without breaking existing functionality

### Robust Error Handling
- **Graceful Degradation**: Handle missing or invalid data gracefully
- **Clear Error Messages**: Provide meaningful feedback for debugging and user experience
- **Resilient Networking**: Handle network failures and timeouts appropriately

### Maintainable Architecture
- **Clear Separation**: Distinct modules for static serving, data proxy, and format conversion
- **Testable Components**: Each component should be unit and integration testable
- **Documentation**: Self-documenting code with comprehensive API documentation

## 3. Architecture

### System Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Web Browser   │◄──►│   rossby-vis     │◄──►│  Rossby Server  │
│                 │    │                  │    │                 │
│ Earth Frontend  │    │ • Static Assets  │    │ • NetCDF Data   │
│ • Visualization │    │ • Data Proxy     │    │ • Metadata API  │
│ • User Controls │    │ • Format Convert │    │ • Time Series   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Component Architecture

#### 1. Static Asset Server
- **Purpose**: Serve embedded Earth frontend files (HTML, CSS, JavaScript)
- **Implementation**: Uses `rust-embed` to bundle all assets into the binary
- **Routes**: 
  - `GET /` → `index.html`
  - `GET /*path` → Static assets with proper MIME types

#### 2. Data Proxy Layer
- **Purpose**: Forward and transform requests between Earth frontend and Rossby server
- **Routes**:
  - `GET /proxy/metadata` → Transform Rossby metadata to Earth format
  - `GET /proxy/data?vars={variables}&time={timestamp}&format=json` → Stream data with format conversion
- **Streaming**: Uses `reqwest` streams with `axum` response streaming
- **Conversion**: Transforms Rossby's unified JSON response into Earth's expected format

#### 3. Format Conversion Engine
- **Metadata Converter**: Transform Rossby NetCDF metadata to Earth header format
- **Data Stream Processor**: Convert data arrays while streaming
- **Grid Parameter Calculator**: Derive Earth-compatible grid parameters

### Data Flow

1. **Initial Load**: Browser requests Earth frontend assets from static server
2. **Metadata Request**: Frontend requests available datasets via proxy
3. **Format Translation**: Proxy converts Rossby JSON metadata to Earth format
4. **Data Streaming**: Large dataset requests stream through format converter
5. **Visualization**: Earth frontend renders using converted data

### Requirements for Rossby Server

The `rossby-vis` project expects the Rossby server to handle all NetCDF-specific processing and provide clean JSON APIs. The Rossby server must:

#### Data Processing Requirements
1. **CF Convention Compliance**: Apply all NetCDF CF convention unpacking (`scale_factor`, `add_offset`, `_FillValue` handling)
2. **Coordinate Transformation**: Provide coordinate arrays in standard decimal degrees
3. **Data Type Conversion**: Return numeric data as JSON-compatible types (not binary NetCDF formats)
4. **Missing Value Handling**: Convert NetCDF fill values to JSON `null` or standardized sentinel values

#### API Interface Requirements

**Metadata Endpoint**: `GET /metadata`
```json
{
  "coordinates": {
    "latitude": [90.0, 89.75, ...],    // Decimal degrees, south-to-north
    "longitude": [0.0, 0.25, ...],     // Decimal degrees, 0-360 or -180-180
    "time": [700464.0, 700465.0, ...]  // Hours since epoch or ISO strings
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
        "standard_name": "eastward_wind"  // CF standard names when available
      },
      "dimensions": ["time", "latitude", "longitude"],
      "shape": [24, 721, 1440]
    }
  }
}
```

**Unified Data Endpoint**: `GET /data?vars={variables}&format=json&{dimension_selectors}`

For web frontends like rossby-vis, the Rossby server provides a unified data endpoint that supports multiple variables and flexible dimension selection:

```bash
# Example request for wind components at specific time
GET /data?vars=u10,v10&time=1672531200&format=json

# Example request for temperature data over a time range
GET /data?vars=t2m&time_range=1672531200,1675209600&format=json
```

**Response Format** (`format=json`):
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

#### Performance Requirements
1. **Streaming Support**: Large data arrays should support chunked transfer encoding
2. **Efficient Serialization**: JSON arrays should be efficiently serialized without excessive memory usage
3. **Caching Headers**: Appropriate HTTP caching headers for static vs. dynamic content
4. **Error Handling**: Meaningful HTTP status codes and error messages

This division of responsibility ensures:
- **Rossby server** handles all domain-specific meteorological data processing
- **rossby-vis** focuses on web serving and format translation between JSON APIs
- **Clear separation** between NetCDF expertise and web visualization expertise


## Appendix 1. Interface of the `rossby` endpoints

TODO:
  (1) Analyze a normal result of the `/metadata` endpoint from a `rossby` server

```json
{"coordinates":{"latitude":[90.0,89.75,89.5,89.25,89.0,88.75,88.5,88.25,88.0,87.75,87.5,87.25,87.0,86.75,86.5,86.25,86.0,85.75,85.5,85.25,85.0,84.75,84.5,84.25,84.0,83.75,83.5,83.25,83.0,82.75,82.5,82.25,82.0,81.75,81.5,81.25,81.0,80.75,80.5,80.25,80.0,79.75,79.5,79.25,79.0,78.75,78.5,78.25,78.0,77.75,77.5,77.25,77.0,76.75,76.5,76.25,76.0,75.75,75.5,75.25,75.0,74.75,74.5,74.25,74.0,73.75,73.5,73.25,73.0,72.75,72.5,72.25,72.0,71.75,71.5,71.25,71.0,70.75,70.5,70.25,70.0,69.75,69.5,69.25,69.0,68.75,68.5,68.25,68.0,67.75,67.5,67.25,67.0,66.75,66.5,66.25,66.0,65.75,65.5,65.25,65.0,64.75,64.5,64.25,64.0,63.75,63.5,63.25,63.0,62.75,62.5,62.25,62.0,61.75,61.5,61.25,61.0,60.75,60.5,60.25,60.0,59.75,59.5,59.25,59.0,58.75,58.5,58.25,58.0,57.75,57.5,57.25,57.0,56.75,56.5,56.25,56.0,55.75,55.5,55.25,55.0,54.75,54.5,54.25,54.0,53.75,53.5,53.25,53.0,52.75,52.5,52.25,52.0,51.75,51.5,51.25,51.0,50.75,50.5,50.25,50.0,49.75,49.5,49.25,49.0,48.75,48.5,48.25,48.0,47.75,47.5,47.25,47.0,46.75,46.5,46.25,46.0,45.75,45.5,45.25,45.0,44.75,44.5,44.25,44.0,43.75,43.5,43.25,43.0,42.75,42.5,42.25,42.0,41.75,41.5,41.25,41.0,40.75,40.5,40.25,40.0,39.75,39.5,39.25,39.0,38.75,38.5,38.25,38.0,37.75,37.5,37.25,37.0,36.75,36.5,36.25,36.0,35.75,35.5,35.25,35.0,34.75,34.5,34.25,34.0,33.75,33.5,33.25,33.0,32.75,32.5,32.25,32.0,31.75,31.5,31.25,31.0,30.75,30.5,30.25,30.0,29.75,29.5,29.25,29.0,28.75,28.5,28.25,28.0,27.75,27.5,27.25,27.0,26.75,26.5,26.25,26.0,25.75,25.5,25.25,25.0,24.75,24.5,24.25,24.0,23.75,23.5,23.25,23.0,22.75,22.5,22.25,22.0,21.75,21.5,21.25,21.0,20.75,20.5,20.25,20.0,19.75,19.5,19.25,19.0,18.75,18.5,18.25,18.0,17.75,17.5,17.25,17.0,16.75,16.5,16.25,16.0,15.75,15.5,15.25,15.0,14.75,14.5,14.25,14.0,13.75,13.5,13.25,13.0,12.75,12.5,12.25,12.0,11.75,11.5,11.25,11.0,10.75,10.5,10.25,10.0,9.75,9.5,9.25,9.0,8.75,8.5,8.25,8.0,7.75,7.5,7.25,7.0,6.75,6.5,6.25,6.0,5.75,5.5,5.25,5.0,4.75,4.5,4.25,4.0,3.75,3.5,3.25,3.0,2.75,2.5,2.25,2.0,1.75,1.5,1.25,1.0,0.75,0.5,0.25,0.0,-0.25,-0.5,-0.75,-1.0,-1.25,-1.5,-1.75,-2.0,-2.25,-2.5,-2.75,-3.0,-3.25,-3.5,-3.75,-4.0,-4.25,-4.5,-4.75,-5.0,-5.25,-5.5,-5.75,-6.0,-6.25,-6.5,-6.75,-7.0,-7.25,-7.5,-7.75,-8.0,-8.25,-8.5,-8.75,-9.0,-9.25,-9.5,-9.75,-10.0,-10.25,-10.5,-10.75,-11.0,-11.25,-11.5,-11.75,-12.0,-12.25,-12.5,-12.75,-13.0,-13.25,-13.5,-13.75,-14.0,-14.25,-14.5,-14.75,-15.0,-15.25,-15.5,-15.75,-16.0,-16.25,-16.5,-16.75,-17.0,-17.25,-17.5,-17.75,-18.0,-18.25,-18.5,-18.75,-19.0,-19.25,-19.5,-19.75,-20.0,-20.25,-20.5,-20.75,-21.0,-21.25,-21.5,-21.75,-22.0,-22.25,-22.5,-22.75,-23.0,-23.25,-23.5,-23.75,-24.0,-24.25,-24.5,-24.75,-25.0,-25.25,-25.5,-25.75,-26.0,-26.25,-26.5,-26.75,-27.0,-27.25,-27.5,-27.75,-28.0,-28.25,-28.5,-28.75,-29.0,-29.25,-29.5,-29.75,-30.0,-30.25,-30.5,-30.75,-31.0,-31.25,-31.5,-31.75,-32.0,-32.25,-32.5,-32.75,-33.0,-33.25,-33.5,-33.75,-34.0,-34.25,-34.5,-34.75,-35.0,-35.25,-35.5,-35.75,-36.0,-36.25,-36.5,-36.75,-37.0,-37.25,-37.5,-37.75,-38.0,-38.25,-38.5,-38.75,-39.0,-39.25,-39.5,-39.75,-40.0,-40.25,-40.5,-40.75,-41.0,-41.25,-41.5,-41.75,-42.0,-42.25,-42.5,-42.75,-43.0,-43.25,-43.5,-43.75,-44.0,-44.25,-44.5,-44.75,-45.0,-45.25,-45.5,-45.75,-46.0,-46.25,-46.5,-46.75,-47.0,-47.25,-47.5,-47.75,-48.0,-48.25,-48.5,-48.75,-49.0,-49.25,-49.5,-49.75,-50.0,-50.25,-50.5,-50.75,-51.0,-51.25,-51.5,-51.75,-52.0,-52.25,-52.5,-52.75,-53.0,-53.25,-53.5,-53.75,-54.0,-54.25,-54.5,-54.75,-55.0,-55.25,-55.5,-55.75,-56.0,-56.25,-56.5,-56.75,-57.0,-57.25,-57.5,-57.75,-58.0,-58.25,-58.5,-58.75,-59.0,-59.25,-59.5,-59.75,-60.0,-60.25,-60.5,-60.75,-61.0,-61.25,-61.5,-61.75,-62.0,-62.25,-62.5,-62.75,-63.0,-63.25,-63.5,-63.75,-64.0,-64.25,-64.5,-64.75,-65.0,-65.25,-65.5,-65.75,-66.0,-66.25,-66.5,-66.75,-67.0,-67.25,-67.5,-67.75,-68.0,-68.25,-68.5,-68.75,-69.0,-69.25,-69.5,-69.75,-70.0,-70.25,-70.5,-70.75,-71.0,-71.25,-71.5,-71.75,-72.0,-72.25,-72.5,-72.75,-73.0,-73.25,-73.5,-73.75,-74.0,-74.25,-74.5,-74.75,-75.0,-75.25,-75.5,-75.75,-76.0,-76.25,-76.5,-76.75,-77.0,-77.25,-77.5,-77.75,-78.0,-78.25,-78.5,-78.75,-79.0,-79.25,-79.5,-79.75,-80.0,-80.25,-80.5,-80.75,-81.0,-81.25,-81.5,-81.75,-82.0,-82.25,-82.5,-82.75,-83.0,-83.25,-83.5,-83.75,-84.0,-84.25,-84.5,-84.75,-85.0,-85.25,-85.5,-85.75,-86.0,-86.25,-86.5,-86.75,-87.0,-87.25,-87.5,-87.75,-88.0,-88.25,-88.5,-88.75,-89.0,-89.25,-89.5,-89.75,-90.0],"longitude":[0.0,0.25,0.5,0.75,1.0,1.25,1.5,1.75,2.0,2.25,2.5,2.75,3.0,3.25,3.5,3.75,4.0,4.25,4.5,4.75,5.0,5.25,5.5,5.75,6.0,6.25,6.5,6.75,7.0,7.25,7.5,7.75,8.0,8.25,8.5,8.75,9.0,9.25,9.5,9.75,10.0,10.25,10.5,10.75,11.0,11.25,11.5,11.75,12.0,12.25,12.5,12.75,13.0,13.25,13.5,13.75,14.0,14.25,14.5,14.75,15.0,15.25,15.5,15.75,16.0,16.25,16.5,16.75,17.0,17.25,17.5,17.75,18.0,18.25,18.5,18.75,19.0,19.25,19.5,19.75,20.0,20.25,20.5,20.75,21.0,21.25,21.5,21.75,22.0,22.25,22.5,22.75,23.0,23.25,23.5,23.75,24.0,24.25,24.5,24.75,25.0,25.25,25.5,25.75,26.0,26.25,26.5,26.75,27.0,27.25,27.5,27.75,28.0,28.25,28.5,28.75,29.0,29.25,29.5,29.75,30.0,30.25,30.5,30.75,31.0,31.25,31.5,31.75,32.0,32.25,32.5,32.75,33.0,33.25,33.5,33.75,34.0,34.25,34.5,34.75,35.0,35.25,35.5,35.75,36.0,36.25,36.5,36.75,37.0,37.25,37.5,37.75,38.0,38.25,38.5,38.75,39.0,39.25,39.5,39.75,40.0,40.25,40.5,40.75,41.0,41.25,41.5,41.75,42.0,42.25,42.5,42.75,43.0,43.25,43.5,43.75,44.0,44.25,44.5,44.75,45.0,45.25,45.5,45.75,46.0,46.25,46.5,46.75,47.0,47.25,47.5,47.75,48.0,48.25,48.5,48.75,49.0,49.25,49.5,49.75,50.0,50.25,50.5,50.75,51.0,51.25,51.5,51.75,52.0,52.25,52.5,52.75,53.0,53.25,53.5,53.75,54.0,54.25,54.5,54.75,55.0,55.25,55.5,55.75,56.0,56.25,56.5,56.75,57.0,57.25,57.5,57.75,58.0,58.25,58.5,58.75,59.0,59.25,59.5,59.75,60.0,60.25,60.5,60.75,61.0,61.25,61.5,61.75,62.0,62.25,62.5,62.75,63.0,63.25,63.5,63.75,64.0,64.25,64.5,64.75,65.0,65.25,65.5,65.75,66.0,66.25,66.5,66.75,67.0,67.25,67.5,67.75,68.0,68.25,68.5,68.75,69.0,69.25,69.5,69.75,70.0,70.25,70.5,70.75,71.0,71.25,71.5,71.75,72.0,72.25,72.5,72.75,73.0,73.25,73.5,73.75,74.0,74.25,74.5,74.75,75.0,75.25,75.5,75.75,76.0,76.25,76.5,76.75,77.0,77.25,77.5,77.75,78.0,78.25,78.5,78.75,79.0,79.25,79.5,79.75,80.0,80.25,80.5,80.75,81.0,81.25,81.5,81.75,82.0,82.25,82.5,82.75,83.0,83.25,83.5,83.75,84.0,84.25,84.5,84.75,85.0,85.25,85.5,85.75,86.0,86.25,86.5,86.75,87.0,87.25,87.5,87.75,88.0,88.25,88.5,88.75,89.0,89.25,89.5,89.75,90.0,90.25,90.5,90.75,91.0,91.25,91.5,91.75,92.0,92.25,92.5,92.75,93.0,93.25,93.5,93.75,94.0,94.25,94.5,94.75,95.0,95.25,95.5,95.75,96.0,96.25,96.5,96.75,97.0,97.25,97.5,97.75,98.0,98.25,98.5,98.75,99.0,99.25,99.5,99.75,100.0,100.25,100.5,100.75,101.0,101.25,101.5,101.75,102.0,102.25,102.5,102.75,103.0,103.25,103.5,103.75,104.0,104.25,104.5,104.75,105.0,105.25,105.5,105.75,106.0,106.25,106.5,106.75,107.0,107.25,107.5,107.75,108.0,108.25,108.5,108.75,109.0,109.25,109.5,109.75,110.0,110.25,110.5,110.75,111.0,111.25,111.5,111.75,112.0,112.25,112.5,112.75,113.0,113.25,113.5,113.75,114.0,114.25,114.5,114.75,115.0,115.25,115.5,115.75,116.0,116.25,116.5,116.75,117.0,117.25,117.5,117.75,118.0,118.25,118.5,118.75,119.0,119.25,119.5,119.75,120.0,120.25,120.5,120.75,121.0,121.25,121.5,121.75,122.0,122.25,122.5,122.75,123.0,123.25,123.5,123.75,124.0,124.25,124.5,124.75,125.0,125.25,125.5,125.75,126.0,126.25,126.5,126.75,127.0,127.25,127.5,127.75,128.0,128.25,128.5,128.75,129.0,129.25,129.5,129.75,130.0,130.25,130.5,130.75,131.0,131.25,131.5,131.75,132.0,132.25,132.5,132.75,133.0,133.25,133.5,133.75,134.0,134.25,134.5,134.75,135.0,135.25,135.5,135.75,136.0,136.25,136.5,136.75,137.0,137.25,137.5,137.75,138.0,138.25,138.5,138.75,139.0,139.25,139.5,139.75,140.0,140.25,140.5,140.75,141.0,141.25,141.5,141.75,142.0,142.25,142.5,142.75,143.0,143.25,143.5,143.75,144.0,144.25,144.5,144.75,145.0,145.25,145.5,145.75,146.0,146.25,146.5,146.75,147.0,147.25,147.5,147.75,148.0,148.25,148.5,148.75,149.0,149.25,149.5,149.75,150.0,150.25,150.5,150.75,151.0,151.25,151.5,151.75,152.0,152.25,152.5,152.75,153.0,153.25,153.5,153.75,154.0,154.25,154.5,154.75,155.0,155.25,155.5,155.75,156.0,156.25,156.5,156.75,157.0,157.25,157.5,157.75,158.0,158.25,158.5,158.75,159.0,159.25,159.5,159.75,160.0,160.25,160.5,160.75,161.0,161.25,161.5,161.75,162.0,162.25,162.5,162.75,163.0,163.25,163.5,163.75,164.0,164.25,164.5,164.75,165.0,165.25,165.5,165.75,166.0,166.25,166.5,166.75,167.0,167.25,167.5,167.75,168.0,168.25,168.5,168.75,169.0,169.25,169.5,169.75,170.0,170.25,170.5,170.75,171.0,171.25,171.5,171.75,172.0,172.25,172.5,172.75,173.0,173.25,173.5,173.75,174.0,174.25,174.5,174.75,175.0,175.25,175.5,175.75,176.0,176.25,176.5,176.75,177.0,177.25,177.5,177.75,178.0,178.25,178.5,178.75,179.0,179.25,179.5,179.75,180.0,180.25,180.5,180.75,181.0,181.25,181.5,181.75,182.0,182.25,182.5,182.75,183.0,183.25,183.5,183.75,184.0,184.25,184.5,184.75,185.0,185.25,185.5,185.75,186.0,186.25,186.5,186.75,187.0,187.25,187.5,187.75,188.0,188.25,188.5,188.75,189.0,189.25,189.5,189.75,190.0,190.25,190.5,190.75,191.0,191.25,191.5,191.75,192.0,192.25,192.5,192.75,193.0,193.25,193.5,193.75,194.0,194.25,194.5,194.75,195.0,195.25,195.5,195.75,196.0,196.25,196.5,196.75,197.0,197.25,197.5,197.75,198.0,198.25,198.5,198.75,199.0,199.25,199.5,199.75,200.0,200.25,200.5,200.75,201.0,201.25,201.5,201.75,202.0,202.25,202.5,202.75,203.0,203.25,203.5,203.75,204.0,204.25,204.5,204.75,205.0,205.25,205.5,205.75,206.0,206.25,206.5,206.75,207.0,207.25,207.5,207.75,208.0,208.25,208.5,208.75,209.0,209.25,209.5,209.75,210.0,210.25,210.5,210.75,211.0,211.25,211.5,211.75,212.0,212.25,212.5,212.75,213.0,213.25,213.5,213.75,214.0,214.25,214.5,214.75,215.0,215.25,215.5,215.75,216.0,216.25,216.5,216.75,217.0,217.25,217.5,217.75,218.0,218.25,218.5,218.75,219.0,219.25,219.5,219.75,220.0,220.25,220.5,220.75,221.0,221.25,221.5,221.75,222.0,222.25,222.5,222.75,223.0,223.25,223.5,223.75,224.0,224.25,224.5,224.75,225.0,225.25,225.5,225.75,226.0,226.25,226.5,226.75,227.0,227.25,227.5,227.75,228.0,228.25,228.5,228.75,229.0,229.25,229.5,229.75,230.0,230.25,230.5,230.75,231.0,231.25,231.5,231.75,232.0,232.25,232.5,232.75,233.0,233.25,233.5,233.75,234.0,234.25,234.5,234.75,235.0,235.25,235.5,235.75,236.0,236.25,236.5,236.75,237.0,237.25,237.5,237.75,238.0,238.25,238.5,238.75,239.0,239.25,239.5,239.75,240.0,240.25,240.5,240.75,241.0,241.25,241.5,241.75,242.0,242.25,242.5,242.75,243.0,243.25,243.5,243.75,244.0,244.25,244.5,244.75,245.0,245.25,245.5,245.75,246.0,246.25,246.5,246.75,247.0,247.25,247.5,247.75,248.0,248.25,248.5,248.75,249.0,249.25,249.5,249.75,250.0,250.25,250.5,250.75,251.0,251.25,251.5,251.75,252.0,252.25,252.5,252.75,253.0,253.25,253.5,253.75,254.0,254.25,254.5,254.75,255.0,255.25,255.5,255.75,256.0,256.25,256.5,256.75,257.0,257.25,257.5,257.75,258.0,258.25,258.5,258.75,259.0,259.25,259.5,259.75,260.0,260.25,260.5,260.75,261.0,261.25,261.5,261.75,262.0,262.25,262.5,262.75,263.0,263.25,263.5,263.75,264.0,264.25,264.5,264.75,265.0,265.25,265.5,265.75,266.0,266.25,266.5,266.75,267.0,267.25,267.5,267.75,268.0,268.25,268.5,268.75,269.0,269.25,269.5,269.75,270.0,270.25,270.5,270.75,271.0,271.25,271.5,271.75,272.0,272.25,272.5,272.75,273.0,273.25,273.5,273.75,274.0,274.25,274.5,274.75,275.0,275.25,275.5,275.75,276.0,276.25,276.5,276.75,277.0,277.25,277.5,277.75,278.0,278.25,278.5,278.75,279.0,279.25,279.5,279.75,280.0,280.25,280.5,280.75,281.0,281.25,281.5,281.75,282.0,282.25,282.5,282.75,283.0,283.25,283.5,283.75,284.0,284.25,284.5,284.75,285.0,285.25,285.5,285.75,286.0,286.25,286.5,286.75,287.0,287.25,287.5,287.75,288.0,288.25,288.5,288.75,289.0,289.25,289.5,289.75,290.0,290.25,290.5,290.75,291.0,291.25,291.5,291.75,292.0,292.25,292.5,292.75,293.0,293.25,293.5,293.75,294.0,294.25,294.5,294.75,295.0,295.25,295.5,295.75,296.0,296.25,296.5,296.75,297.0,297.25,297.5,297.75,298.0,298.25,298.5,298.75,299.0,299.25,299.5,299.75,300.0,300.25,300.5,300.75,301.0,301.25,301.5,301.75,302.0,302.25,302.5,302.75,303.0,303.25,303.5,303.75,304.0,304.25,304.5,304.75,305.0,305.25,305.5,305.75,306.0,306.25,306.5,306.75,307.0,307.25,307.5,307.75,308.0,308.25,308.5,308.75,309.0,309.25,309.5,309.75,310.0,310.25,310.5,310.75,311.0,311.25,311.5,311.75,312.0,312.25,312.5,312.75,313.0,313.25,313.5,313.75,314.0,314.25,314.5,314.75,315.0,315.25,315.5,315.75,316.0,316.25,316.5,316.75,317.0,317.25,317.5,317.75,318.0,318.25,318.5,318.75,319.0,319.25,319.5,319.75,320.0,320.25,320.5,320.75,321.0,321.25,321.5,321.75,322.0,322.25,322.5,322.75,323.0,323.25,323.5,323.75,324.0,324.25,324.5,324.75,325.0,325.25,325.5,325.75,326.0,326.25,326.5,326.75,327.0,327.25,327.5,327.75,328.0,328.25,328.5,328.75,329.0,329.25,329.5,329.75,330.0,330.25,330.5,330.75,331.0,331.25,331.5,331.75,332.0,332.25,332.5,332.75,333.0,333.25,333.5,333.75,334.0,334.25,334.5,334.75,335.0,335.25,335.5,335.75,336.0,336.25,336.5,336.75,337.0,337.25,337.5,337.75,338.0,338.25,338.5,338.75,339.0,339.25,339.5,339.75,340.0,340.25,340.5,340.75,341.0,341.25,341.5,341.75,342.0,342.25,342.5,342.75,343.0,343.25,343.5,343.75,344.0,344.25,344.5,344.75,345.0,345.25,345.5,345.75,346.0,346.25,346.5,346.75,347.0,347.25,347.5,347.75,348.0,348.25,348.5,348.75,349.0,349.25,349.5,349.75,350.0,350.25,350.5,350.75,351.0,351.25,351.5,351.75,352.0,352.25,352.5,352.75,353.0,353.25,353.5,353.75,354.0,354.25,354.5,354.75,355.0,355.25,355.5,355.75,356.0,356.25,356.5,356.75,357.0,357.25,357.5,357.75,358.0,358.25,358.5,358.75,359.0,359.25,359.5,359.75],"time":[700464.0,700465.0,700466.0,700467.0,700468.0,700469.0,700470.0,700471.0,700472.0,700473.0,700474.0,700475.0,700476.0,700477.0,700478.0,700479.0,700480.0,700481.0,700482.0,700483.0,700484.0,700485.0,700486.0,700487.0]},"dimensions":{"latitude":{"is_unlimited":false,"name":"latitude","size":721},"longitude":{"is_unlimited":false,"name":"longitude","size":1440},"time":{"is_unlimited":false,"name":"time","size":24}},"global_attributes":{"Conventions":"CF-1.6","history":"2025-03-26 23:41:47 GMT by grib_to_netcdf-2.16.0: grib_to_netcdf -S param -o /mnt/NASY/ERA5_lvl_redownload//era5.19791129.nc /mnt/NASY/ERA5_lvl_redownload//era5.19791129.grib"},"variables":{"d2m":{"attributes":{"_FillValue":-32767.0,"add_offset":259.75708816027947,"long_name":"2 metre dewpoint temperature","missing_value":-32767.0,"scale_factor":0.001265573972362922,"units":"K"},"dimensions":["time","latitude","longitude"],"dtype":"Basic(Short)","name":"d2m","shape":[24,721,1440]},"latitude":{"attributes":{"long_name":"latitude","units":"degrees_north"},"dimensions":["latitude"],"dtype":"Basic(Float)","name":"latitude","shape":[721]},"longitude":{"attributes":{"long_name":"longitude","units":"degrees_east"},"dimensions":["longitude"],"dtype":"Basic(Float)","name":"longitude","shape":[1440]},"sd":{"attributes":{"_FillValue":-32767.0,"add_offset":4.999923702562068,"long_name":"Snow depth","missing_value":-32767.0,"scale_factor":0.00015259487586406848,"standard_name":"lwe_thickness_of_surface_snow_amount","units":"m of water equivalent"},"dimensions":["time","latitude","longitude"],"dtype":"Basic(Short)","name":"sd","shape":[24,721,1440]},"sp":{"attributes":{"_FillValue":-32767.0,"add_offset":76614.79684042772,"long_name":"Surface pressure","missing_value":-32767.0,"scale_factor":0.8438191445531259,"standard_name":"surface_air_pressure","units":"Pa"},"dimensions":["time","latitude","longitude"],"dtype":"Basic(Short)","name":"sp","shape":[24,721,1440]},"sst":{"attributes":{"_FillValue":-32767.0,"add_offset":287.8537108018932,"long_name":"Sea surface temperature","missing_value":-32767.0,"scale_factor":0.0005862087135488991,"units":"K"},"dimensions":["time","latitude","longitude"],"dtype":"Basic(Short)","name":"sst","shape":[24,721,1440]},"t2m":{"attributes":{"_FillValue":-32767.0,"add_offset":269.12697102071684,"long_name":"2 metre temperature","missing_value":-32767.0,"scale_factor":0.001429052316378294,"units":"K"},"dimensions":["time","latitude","longitude"],"dtype":"Basic(Short)","name":"t2m","shape":[24,721,1440]},"time":{"attributes":{"calendar":"gregorian","long_name":"time","units":"hours since 1900-01-01 00:00:00.0"},"dimensions":["time"],"dtype":"Basic(Int)","name":"time","shape":[24]},"tisr":{"attributes":{"_FillValue":-32767.0,"add_offset":2513689.641798788,"long_name":"TOA incident solar radiation","missing_value":-32767.0,"scale_factor":76.71640242320663,"units":"J m**-2"},"dimensions":["time","latitude","longitude"],"dtype":"Basic(Short)","name":"tisr","shape":[24,721,1440]},"u10":{"attributes":{"_FillValue":-32767.0,"add_offset":1.8308104355477524,"long_name":"10 metre U wind component","missing_value":-32767.0,"scale_factor":0.0007641157819367142,"units":"m s**-1"},"dimensions":["time","latitude","longitude"],"dtype":"Basic(Short)","name":"u10","shape":[24,721,1440]},"u100":{"attributes":{"_FillValue":-32767.0,"add_offset":2.5681195889730355,"long_name":"100 metre U wind component","missing_value":-32767.0,"scale_factor":0.0010136296711169134,"units":"m s**-1"},"dimensions":["time","latitude","longitude"],"dtype":"Basic(Short)","name":"u100","shape":[24,721,1440]},"v10":{"attributes":{"_FillValue":-32767.0,"add_offset":-1.3501874226259039,"long_name":"10 metre V wind component","missing_value":-32767.0,"scale_factor":0.0007288491580577724,"units":"m s**-1"},"dimensions":["time","latitude","longitude"],"dtype":"Basic(Short)","name":"v10","shape":[24,721,1440]},"v100":{"attributes":{"_FillValue":-32767.0,"add_offset":-0.9510499499804727,"long_name":"100 metre V wind component","missing_value":-32767.0,"scale_factor":0.0009463355078202489,"units":"m s**-1"},"dimensions":["time","latitude","longitude"],"dtype":"Basic(Short)","name":"v100","shape":[24,721,1440]}}}
```

## Appendix 2. Interface of the `earth` frontend

### Earth Data Format Analysis

The Earth frontend expects data in a specific format with two main components:

#### 2.1 Catalog Structure
```json
["20140131-surface-currents-oscar-0.33.json"]
```
- Simple array of available dataset filenames
- Used by the frontend to populate data selection menus

#### 2.2 Weather Data Format (GFS Example)
```json
[{
  "header": {
    "discipline": 0,
    "disciplineName": "Meteorological products",
    "refTime": "2014-01-31T00:00:00.000Z",
    "parameterCategory": 2,
    "parameterCategoryName": "Momentum", 
    "parameterNumber": 2,
    "parameterNumberName": "U-component_of_wind",
    "parameterUnit": "m.s-1",
    "nx": 360, "ny": 181,
    "lo1": 0, "la1": 90, "lo2": 359, "la2": -90,
    "dx": 1, "dy": 1
  },
  "data": [-4.76, -4.75, -4.73, -4.72, ...],
  "meta": {"date": "2014-01-31T03:00:00.000Z"}
}]
```

#### 2.3 Ocean Current Data Format (OSCAR Example)
```json
[{
  "header": {
    "discipline": 10,
    "disciplineName": "Oceanographic_products",
    "parameterCategory": 1,
    "parameterCategoryName": "Currents",
    "parameterNumber": 2,
    "parameterNumberName": "U_component_of_current",
    "nx": 1080, "ny": 481,
    "lo1": 20, "la1": 80, "lo2": 379.67, "la2": -80,
    "dx": 0.333, "dy": 0.333
  },
  "data": [null, null, null, -0.02, -0.02, 0, 0.02, ...]
}]
```

#### 2.4 Key Earth Frontend Requirements

1. **Header Structure**: Must contain grid parameters (`nx`, `ny`, `lo1`, `la1`, `lo2`, `la2`, `dx`, `dy`)
2. **Data Array**: 1D flattened array of values, with `null` for missing data
3. **Time Information**: Reference time and forecast time for temporal navigation
4. **Parameter Metadata**: Category, number, unit for variable identification

### Data Injection Mechanism

1. **Catalog Loading**: Frontend fetches catalog JSON to populate dataset selection UI
2. **Data Request**: User selection triggers request for specific dataset file
3. **Grid Parsing**: Header information used to reconstruct 2D grid from 1D data array
4. **Visualization**: Data rendered using D3.js with interpolation for smooth visualization

## Appendix 3. Adaption of the `earth` frontend UI to `rossby` metadata

### UI Adaptation Strategy

#### 3.1 Metadata Transformation Pipeline

**Rossby to Earth Header Mapping:**
```rust
// Pseudo-code transformation
fn transform_rossby_to_earth_header(rossby_meta: RossbyMetadata) -> EarthHeader {
    EarthHeader {
        nx: rossby_meta.dimensions.longitude.size,
        ny: rossby_meta.dimensions.latitude.size,
        lo1: rossby_meta.coordinates.longitude[0],
        la1: rossby_meta.coordinates.latitude[0],
        lo2: rossby_meta.coordinates.longitude.last(),
        la2: rossby_meta.coordinates.latitude.last(),
        dx: calculate_longitude_step(&rossby_meta.coordinates.longitude),
        dy: calculate_latitude_step(&rossby_meta.coordinates.latitude),
        parameterCategoryName: derive_category_from_variable(&variable_name),
        parameterNumberName: rossby_meta.variables[var_name].attributes.long_name,
        parameterUnit: rossby_meta.variables[var_name].attributes.units,
        refTime: convert_time_units(&rossby_meta.coordinates.time[0]),
        // ... other required fields
    }
}
```

#### 3.2 Data Conversion Strategy

1. **Variable Type Support**: Handle both scalar and vector meteorological variables
   - **Scalar Fields**: Temperature (t2m), pressure (sp), precipitation, humidity, etc.
   - **Vector Fields**: Wind (u10/v10), ocean currents (u/v components)
   - **Specialized Fields**: Snow depth (sd), solar radiation (tisr), sea surface temperature (sst)

2. **Variable Selection**: Map Rossby variables to Earth parameter categories
   ```rust
   match variable_name {
       "t2m" => "Temperature",
       "sp" => "Pressure", 
       "d2m" => "Humidity",
       "u10" | "v10" => "Wind",
       "sd" => "Precipitation",
       "sst" => "Temperature",
       _ => "General"
   }
   ```

3. **Grid Alignment**: Handle coordinate system differences (0-360° vs -180°+180°)
4. **Missing Value Handling**: Convert Rossby fill values to `null` for Earth format

##### Scalar vs Vector Visualization

**Scalar Fields** (single value per grid point):
- Temperature, pressure, humidity displayed as color-coded contours
- Earth frontend uses color interpolation for smooth visualization
- Single data array per time step

**Vector Fields** (direction + magnitude):
- Wind/current visualization requires paired U/V components
- Earth frontend renders as particle animations or arrow fields
- Requires coordinated requests for both components

##### NetCDF Data Unpacking Details

NetCDF files often use `scale_factor` and `add_offset` attributes for data compression (packing). The Rossby server stores floating-point data as smaller integers using the formula:

```
stored_integer = (original_float - add_offset) / scale_factor
```

Our conversion engine must apply the reverse unpacking formula:

```rust
unpacked_value = (stored_integer * scale_factor) + add_offset
```

**Example from Rossby metadata:**
```json
"u10": {
  "attributes": {
    "_FillValue": -32767.0,
    "add_offset": 1.8308104355477524,
    "scale_factor": 0.0007641157819367142,
    "units": "m s**-1"
  }
}
```

**Implementation strategy:**
```rust
fn unpack_netcdf_data(
    raw_data: &[i16], 
    scale_factor: f64, 
    add_offset: f64,
    fill_value: i16
) -> Vec<Option<f64>> {
    raw_data.iter().map(|&val| {
        if val == fill_value {
            None  // Convert to null for Earth format
        } else {
            Some((val as f64 * scale_factor) + add_offset)
        }
    }).collect()
}
```

#### 3.3 Frontend Configuration Changes

**Minimal Required Changes:**
1. **Catalog Endpoint**: Change catalog URL from static files to `/proxy/catalog`
2. **Data URLs**: Redirect data requests to `/proxy/data/{variable}/{time}`
3. **Time Navigation**: Adapt time controls to work with Rossby time coordinate arrays

**Optional Enhancements:**
1. **Variable Selection**: Add UI for selecting specific NetCDF variables
2. **Level Selection**: Support multiple pressure/height levels from 3D variables
3. **Time Range Controls**: Enhanced temporal navigation for large time series

#### 3.4 Implementation Approach

```javascript
// Frontend modification example
const DATA_BASE_URL = '/proxy/data/'; // Instead of 'data/'
const CATALOG_URL = '/proxy/catalog';

// Existing Earth code can remain largely unchanged
// Proxy handles format conversion transparently
```

**Benefits of this approach:**
- Minimal frontend code changes required
- Maintains Earth's existing visualization capabilities
- Transparent integration with Rossby backend
- Preserves Earth's performance characteristics through streaming

## Conclusion

The `rossby-vis` project successfully bridges the gap between NetCDF-based meteorological data servers and web-based visualization frontends. By implementing a streaming proxy architecture, the system handles large datasets efficiently while providing format translation between Rossby's NetCDF-oriented JSON APIs and Earth's visualization-optimized data structures.

### Key Achievements

1. **Streaming Architecture**: Chunked transfer encoding prevents memory bloat for multi-gigabyte datasets
2. **Format Translation**: Transparent conversion between Rossby metadata and Earth-compatible headers
3. **Minimal Integration**: Earth frontend requires minimal modifications to work with Rossby data
4. **Performance**: Zero-copy streaming maintains responsiveness for real-time visualization

### Implementation Status

- **Phase 1 Complete**: Static asset serving with embedded Earth frontend
- **Phase 2 Complete**: Streaming data proxy with format conversion
- **Testing**: Comprehensive unit and integration test coverage
- **Documentation**: Complete system design and development guidelines

### Related Documentation

- **Development Plan**: See `doc/plan.md` for detailed implementation roadmap
- **Development Guidelines**: See `AGENT.md` for code quality standards and testing protocols
- **Project Overview**: See `README.md` for build instructions and CI/CD information

The architecture provides a solid foundation for meteorological data visualization while maintaining separation of concerns between data processing (Rossby server) and web presentation (rossby-vis proxy + Earth frontend).
