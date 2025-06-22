use reqwest::blocking::Client;
use std::process::{Child, Command};
use std::thread::sleep;
use std::time::Duration;

struct TestServer {
    child: Child,
}

impl TestServer {
    fn new(port: u16) -> Self {
        // First build the server if it doesn't exist
        let status = Command::new("cargo")
            .args(["build"])
            .status()
            .expect("Failed to build server");

        assert!(status.success(), "Failed to build the server");

        let child = Command::new("target/debug/rossby-vis")
            .arg("--port")
            .arg(port.to_string())
            .spawn()
            .expect("Failed to start server");

        // Give the server time to start
        sleep(Duration::from_secs(2));

        Self { child }
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

// Use serial_test to ensure tests don't run in parallel
// which would cause port conflicts
#[test]
#[ignore = "Covered by integration_tests.rs and causing conflicts when run in parallel"]
fn test_index_page() {
    let port = 8081;
    let _server = TestServer::new(port);
    let client = Client::new();

    let response = client
        .get(&format!("http://localhost:{}", port))
        .send()
        .expect("Failed to send request");

    assert!(response.status().is_success());
    assert!(response
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap()
        .contains("text/html"));

    let body = response.text().unwrap();
    assert!(body.contains("<html"));
}

#[test]
#[ignore = "Covered by integration_tests.rs and causing conflicts when run in parallel"]
fn test_static_asset() {
    let port = 8082;
    let _server = TestServer::new(port);
    let client = Client::new();

    // Test requesting a static asset that should exist
    let response = client
        .get(&format!("http://localhost:{}/index.html", port))
        .send()
        .expect("Failed to send request");

    assert!(response.status().is_success());
    assert!(response
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap()
        .contains("text/html"));
}

#[test]
#[ignore = "Covered by integration_tests.rs and causing conflicts when run in parallel"]
fn test_not_found() {
    let port = 8083;
    let _server = TestServer::new(port);
    let client = Client::new();

    // Test requesting a non-existent asset
    let response = client
        .get(&format!("http://localhost:{}/nonexistent.file", port))
        .send()
        .expect("Failed to send request");

    assert_eq!(response.status().as_u16(), 404);
}
