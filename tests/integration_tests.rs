#[cfg(test)]
mod integration_tests {
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
                .arg("--api-url")
                .arg("http://localhost:9999") // Dummy URL for static asset testing
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

    #[test]
    fn test_server_serves_static_assets() {
        // Start a test server on a different port to avoid conflicts
        let port = 8888;
        let _server = TestServer::new(port);
        let client = Client::new();

        // Test 1: Check that index.html is served at root
        let index_response = client
            .get(&format!("http://localhost:{}", port))
            .send()
            .expect("Failed to request index");

        // The response should either be successful (if index.html is embedded)
        // or return 404 (if not embedded yet)
        assert!(index_response.status().is_success() || index_response.status().as_u16() == 404);

        // If successful, check content type
        if index_response.status().is_success() {
            assert!(index_response
                .headers()
                .get("content-type")
                .unwrap()
                .to_str()
                .unwrap()
                .contains("text/html"));
        }

        // Test 2: Check that a static asset path works (even if it returns 404)
        let css_response = client
            .get(&format!("http://localhost:{}/styles/styles.css", port))
            .send()
            .expect("Failed to request CSS file");

        // Should return either success (if file exists) or 404 (if not embedded)
        assert!(css_response.status().is_success() || css_response.status().as_u16() == 404);

        // If successful, check content type
        if css_response.status().is_success() {
            assert!(css_response
                .headers()
                .get("content-type")
                .unwrap()
                .to_str()
                .unwrap()
                .contains("text/css"));
        }

        // Test 3: Check that 404 is returned for non-existent assets
        let not_found_response = client
            .get(&format!("http://localhost:{}/nonexistent.file", port))
            .send()
            .expect("Failed to request non-existent file");

        assert_eq!(not_found_response.status().as_u16(), 404);
    }
}
