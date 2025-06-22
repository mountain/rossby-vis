use axum::{
    body::Body,
    extract::Path,
    http::{header, Response as HttpResponse, StatusCode},
    response::{Html, IntoResponse, Response},
};
use mime_guess::from_path;

use crate::embed::StaticAssets;

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
