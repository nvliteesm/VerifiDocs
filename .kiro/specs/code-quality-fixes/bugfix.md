# Bugfix Requirements Document

## Introduction

This document addresses five code quality issues found during a code review of the VerifiDocs webapp (a RAG-powered PDF Q&A app built with FastAPI + React). The issues span code duplication, missing authentication, synchronous performance bottlenecks, resource leaks, and insecure CORS configuration. Left unaddressed, these issues create maintenance burden, security vulnerabilities, performance degradation, and disk space leaks.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `calculate_confidence`, `format_sources`, or `build_preview` are modified THEN the system has two divergent copies (one in `app/api/routes/chat.py` and one in `app/rag/response_utils.py`) that must be updated independently, creating inconsistency risk

1.2 WHEN any HTTP request reaches the API without credentials THEN the system grants full access to all documents, chat history, and evaluation endpoints with no identity verification

1.3 WHEN a PDF with many chunks (e.g., 100+) is uploaded THEN the system embeds each chunk sequentially in a synchronous for-loop, causing long response times and potential request timeouts

1.4 WHEN a document is deleted from the database via the DELETE endpoint THEN the system does not remove the corresponding PDF file from the `uploads/` directory, leaking disk space

1.5 WHEN the application is deployed to a public environment THEN the system accepts requests from any origin due to `allow_origins=["*"]` being hardcoded in the CORS middleware configuration

### Expected Behavior (Correct)

2.1 WHEN `calculate_confidence`, `format_sources`, or `build_preview` are needed in `chat.py` THEN the system SHALL import them from the single canonical source in `app/rag/response_utils.py` rather than defining local copies

2.2 WHEN an HTTP request reaches the API THEN the system SHALL validate the request carries a valid API key (via header) and reject unauthenticated requests with a 401 response

2.3 WHEN a PDF with many chunks is uploaded THEN the system SHALL batch the embedding requests (processing multiple chunks per API call) to reduce total processing time and avoid request timeouts

2.4 WHEN a document is deleted from the database via the DELETE endpoint THEN the system SHALL also delete the associated PDF file from the `uploads/` directory if it exists

2.5 WHEN the application starts THEN the system SHALL read allowed CORS origins from an environment variable (with a sensible default for local development) rather than hardcoding a wildcard

### Unchanged Behavior (Regression Prevention)

3.1 WHEN `calculate_confidence` is called with a list of chunks THEN the system SHALL CONTINUE TO return correct confidence levels and reasons based on similarity thresholds (high ≥0.60 with 2+ strong, medium ≥0.40, low otherwise, not_found <0.25 or empty)

3.2 WHEN `format_sources` is called with chunks THEN the system SHALL CONTINUE TO return a list of source dicts with document_id, chunk_index, page_number, similarity (rounded to 4 decimals), and preview fields

3.3 WHEN `build_preview` is called with content THEN the system SHALL CONTINUE TO return the full text if ≤280 chars or a truncated version with "..." suffix if longer

3.4 WHEN a PDF is uploaded with valid content THEN the system SHALL CONTINUE TO extract text, create chunks, generate embeddings, store them in the database, and return a success response

3.5 WHEN a user asks a question against a document THEN the system SHALL CONTINUE TO retrieve relevant chunks, calculate confidence, generate an answer, and return it with sources

3.6 WHEN the frontend makes API requests during local development THEN the system SHALL CONTINUE TO allow cross-origin requests without CORS errors

3.7 WHEN a document is deleted THEN the system SHALL CONTINUE TO remove the document record and associated chunks from the database
