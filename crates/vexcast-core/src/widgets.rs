//! Overlay widgets embedded in the binary (served at /widgets/*).

use axum::body::Body;
use axum::extract::Path;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "../../widgets/"]
#[exclude = "*.md"]
struct Assets;

pub async fn serve(Path(path): Path<String>) -> Response {
    let path = if path.is_empty() || path.ends_with('/') { format!("{path}index.html") } else { path };
    match Assets::get(&path) {
        Some(f) => {
            let mime = f.metadata.mimetype().to_string();
            ([(header::CONTENT_TYPE, mime), (header::CACHE_CONTROL, "no-cache".to_string())], Body::from(f.data.into_owned())).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
