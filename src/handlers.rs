use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, Response as HttpResponse, StatusCode},
    response::{Html, IntoResponse, Response},
};
use futures::StreamExt;
use mime_guess::from_path;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Arc, time::Instant};
use tracing::{error, info, instrument, warn};

use crate::{embed::StaticAssets, error::AppError, log_error, log_proxy_request, server::AppState};

/// Query parameters for the data proxy endpoint
#[derive(Debug, Deserialize)]
pub struct DataQuery {
    /// Comma-separated list of variables to fetch
    vars: Option<String>,
    /// Time parameter for data selection
    time: Option<String>,
    /// Time range for data selection
    time_range: Option<String>,
    /// Any additional query parameters
    #[serde(flatten)]
    extra: HashMap<String, String>,
}

/// Handler for the root path - serves index.html
pub async fn index() -> Response {
    match StaticAssets::get("index.html") {
        Some(content) => match std::str::from_utf8(&content.data) {
            Ok(html) => Html(html.to_string()).into_response(),
            Err(_) => HttpResponse::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::from("Failed to decode index.html"))
                .unwrap()
                .into_response(),
        },
        None => HttpResponse::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("index.html not found"))
            .unwrap()
            .into_response(),
    }
}

/// Handler for other static assets
pub async fn static_asset(Path(path): Path<String>) -> Response {
    match StaticAssets::get(&path) {
        Some(content) => {
            let mime = from_path(&path).first_or_octet_stream();
            HttpResponse::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime.as_ref().to_string())
                .body(Body::from(content.data.to_vec()))
                .unwrap()
                .into_response()
        }
        None => HttpResponse::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::CONTENT_TYPE, "text/plain")
            .body(Body::from("Asset not found"))
            .unwrap()
            .into_response(),
    }
}

/// Handler for the metadata proxy endpoint
#[instrument(skip(state), fields(backend_url))]
pub async fn proxy_metadata(State(state): State<Arc<AppState>>) -> Result<Response, AppError> {
    let start_time = Instant::now();
    let metadata_url = format!("{}/metadata", state.api_url);

    tracing::Span::current().record("backend_url", &metadata_url);
    info!("Proxying metadata request to Rossby server");

    match state.http_client.get(&metadata_url).send().await {
        Ok(response) => {
            let status_code = response.status().as_u16();

            if response.status().is_success() {
                // Get the response body as bytes and stream it
                match response.bytes().await {
                    Ok(body) => {
                        let duration = start_time.elapsed();
                        let bytes_transferred = body.len() as u64;

                        log_proxy_request!(
                            &metadata_url,
                            status_code,
                            duration.as_millis() as u64,
                            bytes_transferred
                        );

                        Ok(HttpResponse::builder()
                            .status(StatusCode::OK)
                            .header(header::CONTENT_TYPE, "application/json")
                            .body(Body::from(body.to_vec()))
                            .unwrap()
                            .into_response())
                    }
                    Err(e) => {
                        let duration = start_time.elapsed();
                        log_error!(e, "Failed to read metadata response body");
                        log_proxy_request!(
                            &metadata_url,
                            status_code,
                            duration.as_millis() as u64,
                            0
                        );

                        Err(AppError::ProxyError(
                            "Failed to read response body".to_string(),
                        ))
                    }
                }
            } else {
                let duration = start_time.elapsed();
                log_proxy_request!(&metadata_url, status_code, duration.as_millis() as u64, 0);

                warn!("Rossby server returned error status: {}", response.status());
                Err(AppError::ProxyError(format!(
                    "Backend server error: {}",
                    response.status()
                )))
            }
        }
        Err(e) => {
            let duration = start_time.elapsed();
            log_error!(e, "Failed to connect to Rossby server");
            log_proxy_request!(&metadata_url, 0, duration.as_millis() as u64, 0);

            Err(AppError::ProxyError(
                "Failed to connect to backend server".to_string(),
            ))
        }
    }
}

/// Handler for the data proxy endpoint with streaming support
#[instrument(skip(state), fields(backend_url, vars, time))]
pub async fn proxy_data(
    State(state): State<Arc<AppState>>,
    Query(params): Query<DataQuery>,
) -> Result<Response, AppError> {
    let start_time = Instant::now();

    info!("Proxying data request to Rossby server: {:?}", params);

    // Build the query string for the Rossby server
    let mut query_params = Vec::new();

    if let Some(vars) = &params.vars {
        query_params.push(format!("vars={}", vars));
        tracing::Span::current().record("vars", vars);
    }

    if let Some(time) = &params.time {
        query_params.push(format!("time={}", time));
        tracing::Span::current().record("time", time);
    }

    if let Some(time_range) = &params.time_range {
        query_params.push(format!("time_range={}", time_range));
    }

    // Always request JSON format for web frontend
    query_params.push("format=json".to_string());

    // Add any extra parameters (except format, which we already set)
    for (key, value) in &params.extra {
        if key != "format" {
            query_params.push(format!("{}={}", key, value));
        }
    }

    let query_string = query_params.join("&");
    let data_url = format!("{}/data?{}", state.api_url, query_string);

    tracing::Span::current().record("backend_url", &data_url);
    info!("Requesting data from: {}", data_url);

    match state.http_client.get(&data_url).send().await {
        Ok(response) => {
            let status_code = response.status().as_u16();

            if response.status().is_success() {
                info!(
                    target: "proxy",
                    backend_url = %data_url,
                    backend_status_code = status_code,
                    "Starting data stream from Rossby server"
                );

                // Stream the response using chunked transfer encoding
                let stream = response.bytes_stream().map(|result| {
                    result.map_err(|e| {
                        error!("Stream error: {}", e);
                        std::io::Error::other(e)
                    })
                });

                Ok(HttpResponse::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::TRANSFER_ENCODING, "chunked")
                    .body(Body::wrap_stream(stream))
                    .unwrap()
                    .into_response())
            } else {
                let duration = start_time.elapsed();
                log_proxy_request!(&data_url, status_code, duration.as_millis() as u64, 0);

                warn!("Rossby server returned error status: {}", response.status());
                Err(AppError::ProxyError(format!(
                    "Backend server error: {}",
                    response.status()
                )))
            }
        }
        Err(e) => {
            let duration = start_time.elapsed();
            log_error!(e, "Failed to connect to Rossby server");
            log_proxy_request!(&data_url, 0, duration.as_millis() as u64, 0);

            Err(AppError::ProxyError(
                "Failed to connect to backend server".to_string(),
            ))
        }
    }
}

/// Earth frontend compatible data structures
#[derive(Serialize)]
struct EarthHeader {
    discipline: u8,
    #[serde(rename = "disciplineName")]
    discipline_name: String,
    #[serde(rename = "refTime")]
    ref_time: String,
    #[serde(rename = "parameterCategory")]
    parameter_category: u8,
    #[serde(rename = "parameterCategoryName")]
    parameter_category_name: String,
    #[serde(rename = "parameterNumber")]
    parameter_number: u8,
    #[serde(rename = "parameterNumberName")]
    parameter_number_name: String,
    #[serde(rename = "parameterUnit")]
    parameter_unit: String,
    nx: u16,
    ny: u16,
    lo1: f64,
    la1: f64,
    lo2: f64,
    la2: f64,
    dx: f64,
    dy: f64,
}

#[derive(Serialize)]
struct EarthDataPoint {
    header: EarthHeader,
    data: Vec<f64>,
    meta: serde_json::Value,
}

/// Grid parameters for Earth headers
#[derive(Debug, Clone)]
struct GridParams {
    nx: u16,
    ny: u16,
    lo1: f64,
    la1: f64,
    lo2: f64,
    la2: f64,
    dx: f64,
    dy: f64,
}

/// Converts Rossby metadata to Earth grid parameters
type EarthGridParams = (u16, u16, f64, f64, f64, f64, f64, f64);

fn rossby_to_earth_grid(metadata: &Value) -> Option<EarthGridParams> {
    let coords = metadata.get("coordinates")?;
    let dims = metadata.get("dimensions")?;

    let lat_array = coords.get("latitude")?.as_array()?;
    let lon_array = coords.get("longitude")?.as_array()?;

    let ny = dims.get("latitude")?.get("size")?.as_u64()? as u16;
    let nx = dims.get("longitude")?.get("size")?.as_u64()? as u16;

    let la1 = lat_array.first()?.as_f64()?;
    let la2 = lat_array.last()?.as_f64()?;
    let lo1 = lon_array.first()?.as_f64()?;
    let lo2 = lon_array.last()?.as_f64()?;

    // Calculate grid spacing
    let dx = if nx > 1 {
        (lo2 - lo1) / (nx - 1) as f64
    } else {
        1.0
    };
    let dy = if ny > 1 {
        (la1 - la2) / (ny - 1) as f64
    } else {
        1.0
    };

    Some((nx, ny, lo1, la1, lo2, la2, dx, dy))
}

/// Converts Rossby time to ISO string
fn rossby_time_to_iso(time_val: f64) -> String {
    // Rossby time is hours since 1900-01-01
    let base = chrono::DateTime::parse_from_rfc3339("1900-01-01T00:00:00Z").unwrap();
    let datetime = base + chrono::Duration::hours(time_val as i64);
    datetime.to_rfc3339()
}

/// Enhanced metadata service for variable discovery and categorization
#[derive(Debug, Clone)]
struct VariableInfo {
    name: String,
    #[allow(dead_code)]
    display_name: String,
    long_name: String,
    units: String,
    category: VariableCategory,
    var_type: VariableType,
    #[allow(dead_code)]
    dimensions: Vec<String>,
}

#[derive(Debug, Clone)]
enum VariableCategory {
    Temperature,
    Wind,
    Pressure,
    Humidity,
    Precipitation,
    Radiation,
    Cloud,
    General,
}

#[derive(Debug, Clone)]
enum VariableType {
    Scalar,
    Vector {
        u_component: String,
        v_component: String,
    },
}

/// Analyzes metadata to discover available variables and their characteristics
fn analyze_metadata_variables(metadata: &Value) -> Vec<VariableInfo> {
    let empty_map = serde_json::Map::new();
    let variables = match metadata.get("variables") {
        Some(vars) => vars.as_object().unwrap_or(&empty_map),
        None => return Vec::new(),
    };

    let mut result = Vec::new();
    let mut processed_vectors = std::collections::HashSet::new();

    // Filter out coordinate variables
    let coordinate_vars = ["longitude", "latitude", "time", "level"];

    for (var_name, var_data) in variables {
        if coordinate_vars.contains(&var_name.as_str()) {
            continue;
        }

        if processed_vectors.contains(var_name) {
            continue;
        }

        let attributes = var_data
            .get("attributes")
            .unwrap_or(&serde_json::Value::Null);
        let dimensions = var_data
            .get("dimensions")
            .and_then(|d| d.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        let long_name = attributes
            .get("long_name")
            .and_then(|v| v.as_str())
            .unwrap_or(var_name);
        let units = attributes
            .get("units")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let category = categorize_variable(var_name, long_name);

        // Check for vector pairs (wind components)
        if let Some(v_component) = find_vector_pair(var_name, variables.keys()) {
            if var_name.starts_with('u') || var_name.starts_with('U') {
                result.push(VariableInfo {
                    name: var_name.clone(),
                    display_name: create_vector_display_name(var_name, &v_component),
                    long_name: long_name.to_string(),
                    units: units.to_string(),
                    category,
                    var_type: VariableType::Vector {
                        u_component: var_name.clone(),
                        v_component: v_component.clone(),
                    },
                    dimensions,
                });
                processed_vectors.insert(var_name.clone());
                processed_vectors.insert(v_component);
            }
        } else {
            // Scalar variable
            result.push(VariableInfo {
                name: var_name.clone(),
                display_name: var_name.clone(), // Keep metadata names exactly as they are
                long_name: long_name.to_string(),
                units: units.to_string(),
                category,
                var_type: VariableType::Scalar,
                dimensions,
            });
        }
    }

    result
}

fn categorize_variable(var_name: &str, long_name: &str) -> VariableCategory {
    let search_text = format!("{} {}", var_name, long_name).to_lowercase();

    if search_text.contains("temperature")
        || search_text.contains("temp")
        || search_text.contains("sst")
        || search_text.contains("t2m")
    {
        VariableCategory::Temperature
    } else if search_text.contains("wind")
        || search_text.contains("u10")
        || search_text.contains("v10")
        || search_text.contains("component")
    {
        VariableCategory::Wind
    } else if search_text.contains("pressure")
        || search_text.contains("sp")
        || search_text.contains("msl")
    {
        VariableCategory::Pressure
    } else if search_text.contains("humidity")
        || search_text.contains("dewpoint")
        || search_text.contains("d2m")
    {
        VariableCategory::Humidity
    } else if search_text.contains("precipitation")
        || search_text.contains("snow")
        || search_text.contains("rain")
        || search_text.contains("sd")
    {
        VariableCategory::Precipitation
    } else if search_text.contains("radiation")
        || search_text.contains("solar")
        || search_text.contains("tisr")
    {
        VariableCategory::Radiation
    } else if search_text.contains("cloud") || search_text.contains("tcw") {
        VariableCategory::Cloud
    } else {
        VariableCategory::General
    }
}

fn find_vector_pair(
    var_name: &str,
    available_vars: impl Iterator<Item = impl AsRef<str>>,
) -> Option<String> {
    let available: Vec<String> = available_vars.map(|v| v.as_ref().to_string()).collect();

    if var_name.starts_with('u') || var_name.starts_with('U') {
        let v_component = var_name.replacen('u', "v", 1).replacen('U', "V", 1);
        if available.contains(&v_component) {
            return Some(v_component);
        }
    }

    None
}

fn create_vector_display_name(u_var: &str, _v_var: &str) -> String {
    if u_var.contains("10") {
        "Wind".to_string()
    } else if u_var.contains("100") {
        "Wind100".to_string()
    } else {
        "Wind".to_string()
    }
}

fn get_category_name(category: &VariableCategory) -> &'static str {
    match category {
        VariableCategory::Temperature => "Temperature",
        VariableCategory::Wind => "Momentum",
        VariableCategory::Pressure => "Pressure",
        VariableCategory::Humidity => "Humidity",
        VariableCategory::Precipitation => "Moisture",
        VariableCategory::Radiation => "Radiation",
        VariableCategory::Cloud => "Cloud",
        VariableCategory::General => "General",
    }
}

/// Dynamic Earth frontend data handler that adapts to any variable from metadata
#[instrument(skip(state), fields(variable = %variable))]
pub async fn earth_dynamic_data(
    State(state): State<Arc<AppState>>,
    Path(variable): Path<String>,
) -> Result<Response, AppError> {
    let start_time = Instant::now();
    info!("Serving Earth-compatible data for variable: {}", variable);

    // Request metadata first to get grid info and variable details
    let metadata_url = format!("{}/metadata", state.api_url);
    let metadata_response = state
        .http_client
        .get(&metadata_url)
        .send()
        .await
        .map_err(|e| AppError::ProxyError(format!("Failed to fetch metadata: {}", e)))?;

    let metadata: Value = metadata_response
        .json()
        .await
        .map_err(|e| AppError::ProxyError(format!("Failed to parse metadata: {}", e)))?;

    // Analyze available variables
    let variables = analyze_metadata_variables(&metadata);

    // Find the requested variable
    let var_info = variables.iter()
        .find(|v| v.name == variable || matches!(&v.var_type, VariableType::Vector { u_component, .. } if u_component == &variable))
        .ok_or_else(|| AppError::ProxyError(format!("Variable '{}' not found in metadata", variable)))?;

    // Get first available time
    let time = metadata
        .get("coordinates")
        .and_then(|c| c.get("time"))
        .and_then(|t| t.as_array())
        .and_then(|arr| arr.first())
        .and_then(|t| t.as_f64())
        .unwrap_or(700464.0);

    // Extract grid parameters
    let (nx, ny, lo1, la1, lo2, la2, dx, dy) = rossby_to_earth_grid(&metadata)
        .ok_or_else(|| AppError::ProxyError("Invalid grid metadata".to_string()))?;

    let ref_time = rossby_time_to_iso(time);

    match &var_info.var_type {
        VariableType::Vector {
            u_component,
            v_component,
        } => {
            // Handle vector data (wind components)
            let data_url = format!(
                "{}/data?vars={},{}&time={}&format=json",
                state.api_url, u_component, v_component, time
            );

            let data_response =
                state.http_client.get(&data_url).send().await.map_err(|e| {
                    AppError::ProxyError(format!("Failed to fetch vector data: {}", e))
                })?;

            let rossby_data: Value = data_response
                .json()
                .await
                .map_err(|e| AppError::ProxyError(format!("Failed to parse vector data: {}", e)))?;

            // Create grid parameters
            let grid = GridParams { nx, ny, lo1, la1, lo2, la2, dx, dy };

            // Create U component data point
            let u_data = extract_variable_data(&rossby_data, u_component);
            let u_header = create_earth_header(
                var_info,
                "U-component",
                2,
                &grid,
                &ref_time,
            );

            // Create V component data point
            let v_data = extract_variable_data(&rossby_data, v_component);
            let v_header = create_earth_header(
                var_info,
                "V-component",
                3,
                &grid,
                &ref_time,
            );

            let earth_data = vec![
                EarthDataPoint {
                    header: u_header,
                    data: u_data,
                    meta: json!({"date": ref_time}),
                },
                EarthDataPoint {
                    header: v_header,
                    data: v_data,
                    meta: json!({"date": ref_time}),
                },
            ];

            let response_json = serde_json::to_string(&earth_data).map_err(|e| {
                AppError::ProxyError(format!("Failed to serialize response: {}", e))
            })?;

            let duration = start_time.elapsed();
            info!(
                "Served Earth vector data for {} in {}ms",
                variable,
                duration.as_millis()
            );

            Ok(HttpResponse::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(response_json))
                .unwrap()
                .into_response())
        }

        VariableType::Scalar => {
            // Handle scalar data
            let data_url = format!(
                "{}/data?vars={}&time={}&format=json",
                state.api_url, variable, time
            );

            let data_response =
                state.http_client.get(&data_url).send().await.map_err(|e| {
                    AppError::ProxyError(format!("Failed to fetch scalar data: {}", e))
                })?;

            let rossby_data: Value = data_response
                .json()
                .await
                .map_err(|e| AppError::ProxyError(format!("Failed to parse scalar data: {}", e)))?;

            // Create grid parameters
            let grid = GridParams { nx, ny, lo1, la1, lo2, la2, dx, dy };

            let var_data = extract_variable_data(&rossby_data, &variable);
            let header = create_earth_header(
                var_info,
                &var_info.long_name,
                0,
                &grid,
                &ref_time,
            );

            let earth_data = vec![EarthDataPoint {
                header,
                data: var_data,
                meta: json!({"date": ref_time}),
            }];

            let response_json = serde_json::to_string(&earth_data).map_err(|e| {
                AppError::ProxyError(format!("Failed to serialize response: {}", e))
            })?;

            let duration = start_time.elapsed();
            info!(
                "Served Earth scalar data for {} in {}ms",
                variable,
                duration.as_millis()
            );

            Ok(HttpResponse::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(response_json))
                .unwrap()
                .into_response())
        }
    }
}

fn extract_variable_data(rossby_data: &Value, variable: &str) -> Vec<f64> {
    rossby_data
        .get("data")
        .and_then(|d| d.get(variable))
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_f64()).collect::<Vec<f64>>())
        .unwrap_or_default()
}

fn create_earth_header(
    var_info: &VariableInfo,
    parameter_name: &str,
    parameter_number: u8,
    grid: &GridParams,
    ref_time: &str,
) -> EarthHeader {
    EarthHeader {
        discipline: 0,
        discipline_name: "Meteorological products".to_string(),
        ref_time: ref_time.to_string(),
        parameter_category: match var_info.category {
            VariableCategory::Temperature => 0,
            VariableCategory::Wind => 2,
            VariableCategory::Pressure => 3,
            VariableCategory::Humidity => 1,
            _ => 255, // General/Unknown
        },
        parameter_category_name: get_category_name(&var_info.category).to_string(),
        parameter_number,
        parameter_number_name: parameter_name.to_string(),
        parameter_unit: var_info.units.clone(),
        nx: grid.nx,
        ny: grid.ny,
        lo1: grid.lo1,
        la1: grid.la1,
        lo2: grid.lo2,
        la2: grid.la2,
        dx: grid.dx,
        dy: grid.dy,
    }
}

/// Legacy handler for Earth frontend wind data requests - redirects to dynamic handler
#[instrument(skip(state))]
pub async fn earth_wind_data(State(state): State<Arc<AppState>>) -> Result<Response, AppError> {
    info!("Legacy wind data request - redirecting to dynamic handler");

    // Find the first available wind variable from metadata
    let metadata_url = format!("{}/metadata", state.api_url);
    let metadata_response = state
        .http_client
        .get(&metadata_url)
        .send()
        .await
        .map_err(|e| AppError::ProxyError(format!("Failed to fetch metadata: {}", e)))?;

    let metadata: Value = metadata_response
        .json()
        .await
        .map_err(|e| AppError::ProxyError(format!("Failed to parse metadata: {}", e)))?;

    let variables = analyze_metadata_variables(&metadata);

    // Find first wind vector variable
    let wind_var = variables
        .iter()
        .find(|v| {
            matches!(v.category, VariableCategory::Wind)
                && matches!(v.var_type, VariableType::Vector { .. })
        })
        .map(|v| match &v.var_type {
            VariableType::Vector { u_component, .. } => u_component.clone(),
            _ => v.name.clone(),
        })
        .unwrap_or_else(|| "u10".to_string()); // Fallback to common wind variable

    earth_dynamic_data(State(state), Path(wind_var)).await
}

/// Legacy handler for Earth frontend temperature data requests - redirects to dynamic handler
#[instrument(skip(state))]
pub async fn earth_temp_data(State(state): State<Arc<AppState>>) -> Result<Response, AppError> {
    info!("Legacy temperature data request - redirecting to dynamic handler");

    // Find the first available temperature variable from metadata
    let metadata_url = format!("{}/metadata", state.api_url);
    let metadata_response = state
        .http_client
        .get(&metadata_url)
        .send()
        .await
        .map_err(|e| AppError::ProxyError(format!("Failed to fetch metadata: {}", e)))?;

    let metadata: Value = metadata_response
        .json()
        .await
        .map_err(|e| AppError::ProxyError(format!("Failed to parse metadata: {}", e)))?;

    let variables = analyze_metadata_variables(&metadata);

    // Find first temperature variable
    let temp_var = variables
        .iter()
        .find(|v| matches!(v.category, VariableCategory::Temperature))
        .map(|v| v.name.clone())
        .unwrap_or_else(|| "t2m".to_string()); // Fallback to common temperature variable

    earth_dynamic_data(State(state), Path(temp_var)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_index_handler() {
        // We can only test the handler if the embedded assets are available
        let response = index().await;

        // The status will depend on whether index.html exists in the embedded assets
        if StaticAssets::get("index.html").is_some() {
            assert_eq!(response.status(), StatusCode::OK);
        } else {
            assert_eq!(response.status(), StatusCode::NOT_FOUND);
        }
    }
}
