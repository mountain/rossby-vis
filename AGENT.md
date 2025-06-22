# Agent Development Guidelines for Project Rossby

## 1. Mission Briefing

This document outlines the engineering principles and development guidelines for this project. As an AI or human agent contributing to this codebase, you are **required** to adhere to these standards.

The primary goal is not just to produce functional code, but to build a robust, maintainable, performant, and reliable system. Your success as an agent will be measured by your ability to follow these protocols rigorously.

## 2. Core Principles

1.  **Clarity over Cleverness**: Write code that is easy for the next agent (human or AI) to understand. Avoid obscure language features or overly complex one-liners.
2.  **Test Rigorously**: No feature is complete until it is tested. Code without tests is considered broken.
3.  **Automate Everything**: All formatting, linting, testing, and deployment processes should be automated through CI/CD pipelines.
4.  **Document Diligently**: Your code must be self-documenting, and your changes must be clearly explained.

## 3. The Development Protocol

### 3.1. Code Quality & Style

- **Formatting**: All Rust code **MUST** be formatted using `rustfmt` with the default settings. No code will be accepted that does not pass `cargo fmt --check`.
- **Linting**: All Rust code **MUST** be free of warnings from `clippy`. Run `cargo clippy -- -D warnings` before committing. Your code must compile without any warnings.
- **Modularity**: Keep functions small and focused on a single responsibility. Decompose complex logic into well-named private helper functions.
- **Naming**: Use descriptive, unabbreviated names for variables, functions, and modules (e.g., `bilinear_interpolation` is better than `bl_interp`).

### 3.2. Testing Protocol (MANDATORY)

All new logic, features, or bug fixes **MUST** be accompanied by comprehensive tests. Pull requests without adequate testing will be rejected. The project utilizes two levels of testing.

#### 3.2.1. Unit Tests

- **Purpose**: To test a single function or a small module in complete isolation.
- **Location**: In a `#[cfg(test)]` module at the bottom of the file you are testing.
- **Requirements**:
    - Test all public methods.
    - Cover happy paths, edge cases (e.g., zero, negative numbers, empty inputs), and expected error conditions.
    - Use mock data where appropriate, but do not mock the logic being tested.

**Example of a required unit test:**

```rust
// in src/interpolation.rs
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

#[cfg(test)]
mod tests {
    use super::*; // Import the function from the parent module

    #[test]
    fn test_add_positive_numbers() {
        assert_eq!(add(2, 3), 5);
    }

    #[test]
    fn test_add_negative_numbers() {
        assert_eq!(add(-2, -3), -5);
    }

    #[test]
    fn test_add_with_zero() {
        assert_eq!(add(5, 0), 5);
    }
}
```

#### 3.2.2. Integration Tests

- **Purpose**: To test how different parts of the application work together. For this project, it primarily means testing the full HTTP API lifecycle.
- **Location**: In the `tests/` directory at the root of the project.
- **Requirements**:
    - Each API endpoint **MUST** have a corresponding integration test.
    - Tests should start a real instance of the Axum server.
    - Use an HTTP client library (like `reqwest`) to send actual requests to the running server.
    - Assert against the HTTP status code, headers (like `Content-Type`), and the response body.
    - Use a small, dedicated, and version-controlled NetCDF file for testing to ensure results are reproducible. Do not rely on large, external data files.
    - Test both successful requests and expected user errors (e.g., invalid query parameters, out-of-bounds requests).

### 3.3. Documentation Protocol

- **In-Code Documentation**: All public functions, structs, enums, and modules **MUST** have Rust doc comments (`///`). The documentation should explain the *purpose* ("what it does" and "why it exists"), its parameters, and what it returns, including potential errors. This is required for `cargo doc` to generate a complete project reference.
- **Version Control Documentation**: See section 3.4.

### 3.4. Version Control (Git) Protocol

- **Branching**: All work must be done on a feature branch created from the `main` branch. Do not commit directly to `main`.
- **Pre-Commit Verification**: Before committing any changes, you **MUST** ensure that all checks pass locally:
    - Formatting: `cargo fmt --check`
    - Linting: `cargo clippy -- -D warnings`
    - Testing: `cargo test`
    - Documentation: `cargo doc --no-deps`
    - Code that does not pass ALL these checks is not ready for commit.
- **Commit Messages**: Commits **MUST** follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.
    - `feat: Add /metadata endpoint`
    - `fix: Correctly handle longitude wrapping in interpolation`
    - `docs: Update README with new API parameters`
    - `test: Add integration test for invalid bbox in /image endpoint`
- **Pull Requests (PRs)**:
    - All changes must be submitted as a Pull Request to the `main` branch.
    - The PR description must clearly explain the "what" and "why" of the changes.
    - A PR **will not be considered for review** until all automated CI checks (formatting, linting, testing) have passed.

### 3.5. Error Handling Protocol

- **Use `Result<T, E>`**: All functions that can fail **MUST** return a `Result`.
- **No `.unwrap()` or `.expect()`**: The use of `.unwrap()` or `.expect()` is **strictly forbidden** in the application logic. They may only be used in tests where a failure is explicitly not expected.
- **Custom Error Types**: Use a custom, comprehensive error enum (e.g., using the `thiserror` crate) to provide structured, meaningful errors. This allows the API to return clean, informative JSON error messages to the user.

### 3.6. Performance Protocol

- **Benchmarking**: For performance-critical functions (e.g., the interpolation algorithm, image rendering loop), benchmarks **SHOULD** be added using the `criterion.rs` library.
- **No Premature Optimization**: Do not optimize code without evidence from profiling. Write clear, correct code first. If performance becomes an issue, use profiling tools (like `perf` or `flamegraph`) to identify the bottleneck before refactoring.
