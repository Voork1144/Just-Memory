//! Search/retrieval pipeline — 6-path hybrid search with RRF fusion.
//!
//! TEMPR architecture: 6 parallel retrieval paths → RRF fusion → composite
//! scoring → optional cross-encoder reranking → MMR diversity.

pub mod engine;
pub mod paths;
pub mod query;
pub mod reranker;
pub mod scoring;
pub mod vector_stores;

