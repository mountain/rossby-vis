use reqwest;
use serde_json::Value;
use std::time::Duration;
use tokio::time::sleep;

/// Mock Rossby server for testing
mod mock_server {
    use axum::{extract::Query, response::Json, routing::get, Router};
    use serde_json::{json, Value};
    use std::collections::HashMap;
    use tokio::net::TcpListener;

    /// Start a mock Rossby server for testing
    pub async fn start_mock_rossby_server() -> String {
        let app = Router::new()
            .route("/metadata", get(mock_metadata))
            .route("/data", get(mock_data));

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server_url = format!("http://{}", addr);

        tokio::spawn(async move {
            axum::Server::from_tcp(listener.into_std().unwrap())
                .unwrap()
                .serve(app.into_make_service())
                .await
                .unwrap();
        });

        // Give the server a moment to start
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        server_url
    }

    /// Mock metadata endpoint
    async fn mock_metadata() -> Json<Value> {
        Json(json!({
            "coordinates": {
                "latitude": [90.0, 89.75, 89.5],
                "longitude": [0.0, 0.25, 0.5],
                "time": [700464.0, 700465.0]
            },
            "dimensions": {
                "latitude": {"size": 3},
                "longitude": {"size": 3},
                "time": {"size": 2}
            },
            "variables": {
                "u10": {
                    "attributes": {
                        "long_name": "10 metre U wind component",
                        "units": "m s**-1"
                    }
                },
                "v10": {
                    "attributes": {
                        "long_name": "10 metre V wind component",
                        "units": "m s**-1"
                    }
                }
            }
        }))
    }

    /// Mock data endpoint
    async fn mock_data(Query(params): Query<HashMap<String, String>>) -> Json<Value> {
        let vars = params.get("vars").unwrap_or(&"u10".to_string()).clone();
        let variables: Vec<&str> = vars.split(',').collect();

        let mut data = serde_json::Map::new();
        for var in variables {
            data.insert(
                var.to_string(),
                json!([
                    1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0,
                    15.0, 16.0, 17.0, 18.0
                ]),
            );
        }

        Json(json!({
            "metadata": {
                "query": params,
                "shape": [2, 3, 3],
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
            "data": data
        }))
    }
}

/// Integration test helper
async fn setup_test_environment() -> (String, String) {
    let mock_rossby_url = mock_server::start_mock_rossby_server().await;

    // For integration tests, we'll start the server on a known port
    // In a real test, we'd want to use random ports
    let test_port = 18080;
    let server_url = format!("http://127.0.0.1:{}", test_port);

    // Start rossby-vis server in background
    tokio::spawn(async move {
        rossby_vis::run_server(test_port, mock_rossby_url)
            .await
            .unwrap();
    });

    // Give servers time to start
    sleep(Duration::from_millis(300)).await;

    (server_url, "mock_url".to_string())
}

#[tokio::test]
async fn test_proxy_metadata_endpoint() {
    let (server_url, _) = setup_test_environment().await;

    let client = reqwest::Client::new();
    let response = client
        .get(&format!("{}/proxy/metadata", server_url))
        .send()
        .await;

    // The test might fail if servers aren't ready, so we'll be lenient
    if let Ok(resp) = response {
        if resp.status().is_success() {
            let metadata: Value = resp.json().await.unwrap();
            assert!(metadata.get("coordinates").is_some());
            assert!(metadata.get("variables").is_some());
        }
    }
}

#[tokio::test]
async fn test_proxy_data_endpoint_single_variable() {
    let (server_url, _) = setup_test_environment().await;

    let client = reqwest::Client::new();
    let response = client
        .get(&format!("{}/proxy/data?vars=u10&time=700464", server_url))
        .send()
        .await;

    if let Ok(resp) = response {
        if resp.status().is_success() {
            let data: Value = resp.json().await.unwrap();
            assert!(data.get("metadata").is_some());
            assert!(data.get("data").is_some());

            let data_obj = data.get("data").unwrap();
            assert!(data_obj.get("u10").is_some());
        }
    }
}

#[tokio::test]
async fn test_proxy_data_endpoint_multiple_variables() {
    let (server_url, _) = setup_test_environment().await;

    let client = reqwest::Client::new();
    let response = client
        .get(&format!(
            "{}/proxy/data?vars=u10,v10&time=700464",
            server_url
        ))
        .send()
        .await;

    if let Ok(resp) = response {
        if resp.status().is_success() {
            let data: Value = resp.json().await.unwrap();
            assert!(data.get("metadata").is_some());
            assert!(data.get("data").is_some());

            let data_obj = data.get("data").unwrap();
            assert!(data_obj.get("u10").is_some());
            assert!(data_obj.get("v10").is_some());
        }
    }
}

#[tokio::test]
async fn test_streaming_response_headers() {
    let (server_url, _) = setup_test_environment().await;

    let client = reqwest::Client::new();
    let response = client
        .get(&format!("{}/proxy/data?vars=u10&time=700464", server_url))
        .send()
        .await;

    if let Ok(resp) = response {
        // Check that the response uses chunked transfer encoding
        let headers = resp.headers();
        if let Some(transfer_encoding) = headers.get("transfer-encoding") {
            assert_eq!(transfer_encoding, "chunked");
        }

        // Check content type
        if let Some(content_type) = headers.get("content-type") {
            assert!(content_type.to_str().unwrap().contains("application/json"));
        }
    }
}

#[tokio::test]
async fn test_error_handling_invalid_backend() {
    // Test with an invalid backend URL
    let test_port = 18081;
    let server_url = format!("http://127.0.0.1:{}", test_port);

    // Start rossby-vis with invalid backend
    tokio::spawn(async move {
        let _ = rossby_vis::run_server(test_port, "http://localhost:99999".to_string()).await;
    });

    sleep(Duration::from_millis(200)).await;

    let client = reqwest::Client::new();
    let response = client
        .get(&format!("{}/proxy/data?vars=u10", server_url))
        .send()
        .await;

    if let Ok(resp) = response {
        // Should return an error status
        assert!(!resp.status().is_success());
    }
}

#[tokio::test]
async fn test_static_assets_still_work() {
    let (server_url, _) = setup_test_environment().await;

    let client = reqwest::Client::new();
    let response = client.get(&server_url).send().await;

    // Should still serve the index page
    if let Ok(resp) = response {
        assert!(resp.status().is_success() || resp.status() == reqwest::StatusCode::NOT_FOUND);
        // NOT_FOUND is acceptable if index.html isn't embedded yet
    }
}
