use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "public/"]
pub struct StaticAssets;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_static_assets_exist() {
        // Test that index.html exists in the embedded assets
        assert!(StaticAssets::get("index.html").is_some());
    }
}
