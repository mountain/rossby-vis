use thiserror::Error;

/// Application errors
#[derive(Error, Debug)]
pub enum AppError {
    /// Error returned when the server encounters an IO error
    #[error("Server error: {0}")]
    ServerError(#[from] std::io::Error),
}
