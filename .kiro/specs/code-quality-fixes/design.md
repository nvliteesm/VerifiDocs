# Code Quality Fixes Bugfix Design

## Overview

This design addresses five code quality issues in the VerifiDocs backend: duplicated utility functions, missing API authentication, synchronous embedding bottleneck, orphaned file cleanup on deletion, and insecure CORS wildcard configuration. The fix strategy is to apply each change in isolation so that regressions can be traced to a specific modification. The core principle is minimality — each fix targets the defect precisely without altering unrelated logic paths.

## Glossary

- **Bug_Condition (C)**: The set of conditions under which each of the five defects manifests (duplication divergence, unauthenticated access, sequential embedding, orphaned files, wildcard CORS)
- **Property (P)**: The correct behavior that should hold after the fix is applied for each defect
- **Preservation**: Existing behaviors (confidence calculation logic, source formatting, preview truncation, upload pipeline, chat Q&A flow, local dev CORS, database record deletion) that must remain unchanged
- **`response_utils.py`**: The canonical module at `app/rag/response_utils.py` containing `calculate_confidence`, `format_sources`, and `build_preview`
- **`chat.py`**: The route module at `app/api/routes/chat.py` that currently contains duplicate copies of the utility functions
- **`documents.py`**: The route module at `app/api/routes/documents.py` handling upload and delete endpoints
- **`main.py`**: The application entry point at `app/main.py` that configures CORS middleware
- **`embeddings.py`**: The module at `app/rag/embeddings.py` providing the `create_embedding` function
- **`config.py`**: The settings module at `app/core/config.py` using `pydantic_settings`

## Bug Details

### Bug Condition

The five defects manifest under the following composite condition: the system is running with its current codebase and receives any HTTP request OR a developer modifies one of the duplicated utility functions OR a PDF with many chunks is uploaded OR a document is deleted.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type SystemEvent (request, code_change, upload, delete, deployment)
  OUTPUT: boolean

  duplication_bug := input.type == "code_change"
                     AND input.target IN ["calculate_confidence", "format_sources", "build_preview"]
                     AND file_has_local_copy("app/api/routes/chat.py", input.target)

  auth_bug := input.type == "http_request"
              AND NOT input.headers.contains("X-API-Key")
              AND request_is_accepted(input)

  embedding_bug := input.type == "upload"
                   AND len(input.chunks) > 1
                   AND embeddings_created_sequentially(input.chunks)

  file_leak_bug := input.type == "delete"
                   AND document_has_file(input.document_id, "uploads/")
                   AND NOT file_removed_after_delete(input.document_id)

  cors_bug := input.type == "deployment"
              AND input.environment != "local"
              AND cors_allows_origin("*")

  RETURN duplication_bug OR auth_bug OR embedding_bug OR file_leak_bug OR cors_bug
END FUNCTION
```

### Examples

- **Duplication**: Developer updates `calculate_confidence` threshold from 0.60 to 0.55 in `response_utils.py` but forgets the copy in `chat.py` → inconsistent confidence scores depending on code path
- **Auth**: `GET /documents/` called with no `X-API-Key` header → 200 OK with full document list (expected: 401 Unauthorized)
- **Embedding**: Upload a 50-page PDF producing 120 chunks → each chunk calls Gemini API individually, taking ~60s total (expected: batched calls completing in ~5-10s)
- **File Leak**: `DELETE /documents/{id}` removes DB records → PDF file remains in `uploads/` consuming disk (expected: file also deleted)
- **CORS**: App deployed to `https://verifidocs.example.com` → `curl -H "Origin: https://evil.com" ...` receives `Access-Control-Allow-Origin: *` (expected: only allowed origins)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- `calculate_confidence` returns correct confidence levels: high (≥0.60 best AND ≥2 strong sources ≥0.45), medium (≥0.40), low (otherwise), not_found (<0.25 or empty)
- `format_sources` returns list of source dicts with keys: document_id, chunk_index, page_number, similarity (rounded to 4 decimals), preview
- `build_preview` returns full text if ≤280 chars, or truncated with "..." suffix
- PDF upload pipeline: extract text → chunk → embed → store in DB → return success
- Chat Q&A flow: retrieve chunks → confidence → generate answer → return with sources
- Local development CORS: frontend at localhost can make API requests without errors
- Document deletion: DB records (document + chunks) are removed correctly

**Scope:**
All inputs that do NOT involve the five defect conditions should be completely unaffected by these fixes. This includes:
- All existing response formatting logic (same inputs produce same outputs)
- Upload flow for PDFs (same end result, just faster embedding)
- Chat query handling and history management
- Evaluation endpoints
- Health check and root endpoints

## Hypothesized Root Cause

Based on the bug description and source code analysis, the root causes are:

1. **Code Duplication (Issue 1.1)**: `chat.py` defines its own `calculate_confidence`, `format_sources`, and `build_preview` functions (lines 175-225) that are identical copies of those in `app/rag/response_utils.py`. The functions are called locally in `chat.py` rather than imported from the canonical module.

2. **Missing Authentication (Issue 1.2)**: No authentication middleware or dependency is configured anywhere in the application. `main.py` registers routers without any auth guards, and no `Depends()` with an auth function exists on any route.

3. **Sequential Embedding (Issue 1.3)**: In `documents.py` (line 143-149), the upload handler iterates over chunks with a `for` loop, calling `create_embedding(chunk["content"], ...)` one at a time. The Gemini `embed_content` API supports batching multiple texts in a single call, but the code does not use this capability.

4. **Orphaned File on Delete (Issue 1.4)**: The `delete_document` handler in `documents.py` (line 85-101) only deletes the database record. It fetches the document metadata (which contains filename info) but never uses it to locate and remove the corresponding file from the `uploads/` directory. Additionally, the document record does not store the file path — only `filename` (the original user filename), making it difficult to locate the UUID-prefixed stored file.

5. **Hardcoded CORS Wildcard (Issue 1.5)**: `main.py` (line 14) sets `allow_origins=["*"]` directly. There is no environment variable read, and no conditional logic for different deployment environments.

## Correctness Properties

Property 1: Bug Condition - Duplicated Functions Removed

_For any_ call to `calculate_confidence`, `format_sources`, or `build_preview` originating from `chat.py`, the fixed code SHALL use the imported implementation from `app/rag/response_utils.py` rather than a locally-defined copy, ensuring a single source of truth.

**Validates: Requirements 2.1**

Property 2: Bug Condition - Unauthenticated Requests Rejected

_For any_ HTTP request to a protected API endpoint that does NOT include a valid `X-API-Key` header, the fixed code SHALL return a 401 Unauthorized response and NOT process the request.

**Validates: Requirements 2.2**

Property 3: Bug Condition - Embeddings Created in Batches

_For any_ PDF upload producing more than one chunk, the fixed code SHALL call the embedding API with batches of chunks (rather than one chunk at a time) to reduce total API calls and processing time.

**Validates: Requirements 2.3**

Property 4: Bug Condition - File Deleted on Document Removal

_For any_ document deletion where an associated PDF file exists in the `uploads/` directory, the fixed code SHALL remove that file from disk after successfully deleting the database records.

**Validates: Requirements 2.4**

Property 5: Bug Condition - CORS Origins from Environment

_For any_ application startup, the fixed code SHALL read allowed CORS origins from an environment variable (`CORS_ALLOWED_ORIGINS`) and apply them to the middleware, defaulting to `["http://localhost:5173"]` for local development.

**Validates: Requirements 2.5**

Property 6: Preservation - Utility Function Behavior Unchanged

_For any_ input to `calculate_confidence`, `format_sources`, or `build_preview`, the fixed code SHALL produce the same output as the original code, preserving all confidence thresholds, source formatting, and preview truncation logic.

**Validates: Requirements 3.1, 3.2, 3.3**

Property 7: Preservation - Upload Pipeline Output Unchanged

_For any_ valid PDF upload, the fixed code SHALL produce the same end result (document record, chunk records with correct embeddings) as the original code, differing only in the number of API calls made (batched vs sequential).

**Validates: Requirements 3.4, 3.5**

Property 8: Preservation - Local Development CORS Unchanged

_For any_ request from `http://localhost:5173` (the default Vite dev server), the fixed code SHALL continue to allow cross-origin requests without CORS errors.

**Validates: Requirements 3.6**

Property 9: Preservation - Database Deletion Unchanged

_For any_ document deletion, the fixed code SHALL continue to remove the document record and associated chunk records from the database exactly as before.

**Validates: Requirements 3.7**

## Fix Implementation

### Changes Required

**File**: `app/api/routes/chat.py`

**Changes**:
1. **Remove duplicate functions**: Delete the local definitions of `calculate_confidence`, `format_sources`, and `build_preview` (approximately lines 175-225)
2. **Add import**: Add `from app.rag.response_utils import calculate_confidence, format_sources, build_preview` at the top of the file

---

**File**: `app/core/config.py`

**Changes**:
1. **Add `api_key` setting**: Add an `api_key: str` field to the `Settings` class for API authentication
2. **Add `cors_allowed_origins` setting**: Add a `cors_allowed_origins: str = "http://localhost:5173"` field that accepts a comma-separated string of allowed origins

---

**File**: `app/main.py`

**Changes**:
1. **Read CORS origins from config**: Replace `allow_origins=["*"]` with `allow_origins=settings.cors_allowed_origins.split(",")` using the new setting
2. **Import settings**: Add `from app.core.config import settings`

---

**File**: `app/api/routes/documents.py`

**Changes**:
1. **Store file path in DB**: When inserting the document record, include the `safe_filename` (or full relative path) so it can be retrieved during deletion
2. **Delete file on document removal**: In `delete_document`, after successful DB deletion, use the stored file path to remove the PDF from `uploads/` (with `os.path.exists` check and error handling)
3. **Batch embeddings**: Replace the sequential `for chunk in chunks: embedding = create_embedding(...)` loop with a batch call. Create a new `create_embeddings_batch` function in `embeddings.py` that accepts a list of texts and returns a list of embedding vectors.

---

**File**: `app/rag/embeddings.py`

**Changes**:
1. **Add batch embedding function**: Create `create_embeddings_batch(texts: list[str], task_type: str, batch_size: int = 100) -> list[list[float]]` that sends multiple texts per API call using Gemini's batch embedding support

---

**File**: New file `app/api/dependencies.py`

**Changes**:
1. **Create auth dependency**: Define `verify_api_key(x_api_key: str = Header(...))` that checks the provided key against `settings.api_key` and raises `HTTPException(401)` on mismatch
2. **Apply to routers**: Add the dependency to each router or as a global dependency on the app

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate each bug on unfixed code, then verify each fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate each bug BEFORE implementing the fix. Confirm or refute the root cause analysis.

**Test Plan**: Write targeted tests that exercise each defect condition against the current codebase and observe the failures.

**Test Cases**:
1. **Duplication Divergence Test**: Modify one copy of `calculate_confidence` and verify the two copies produce different outputs for the same input (will demonstrate divergence risk)
2. **Auth Bypass Test**: Send requests to `/documents/` with no API key header → observe 200 response (will fail on unfixed code by succeeding without auth)
3. **Sequential Embedding Timing Test**: Upload a PDF with 50+ chunks and measure total embedding time vs. theoretical batch time (will show performance gap on unfixed code)
4. **Orphaned File Test**: Upload a PDF, note the file in `uploads/`, delete the document via API, check `uploads/` directory (file will still exist on unfixed code)
5. **CORS Wildcard Test**: Inspect CORS headers in response to preflight request from arbitrary origin (will show `*` on unfixed code)

**Expected Counterexamples**:
- Requests without credentials succeed with 200
- PDF files remain on disk after document deletion
- Embedding takes O(n) API calls instead of O(n/batch_size)
- CORS allows any origin regardless of deployment

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  IF input.type == "code_change" THEN
    ASSERT chat.py does NOT define calculate_confidence, format_sources, or build_preview locally
    ASSERT chat.py imports from app.rag.response_utils
  IF input.type == "http_request" AND NOT has_valid_api_key(input) THEN
    result := send_request(input)
    ASSERT result.status_code == 401
  IF input.type == "upload" AND len(input.chunks) > 1 THEN
    ASSERT embedding_api_calls < len(input.chunks)
  IF input.type == "delete" AND file_exists(input.file_path) THEN
    delete_document(input.document_id)
    ASSERT NOT file_exists(input.file_path)
  IF input.type == "deployment" AND input.environment != "local" THEN
    ASSERT cors_origins != ["*"]
    ASSERT cors_origins == settings.cors_allowed_origins.split(",")
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT calculate_confidence_fixed(input) == calculate_confidence_original(input)
  ASSERT format_sources_fixed(input) == format_sources_original(input)
  ASSERT build_preview_fixed(input) == build_preview_original(input)
  ASSERT upload_pipeline_fixed(input).result == upload_pipeline_original(input).result
  ASSERT delete_document_fixed(input).db_state == delete_document_original(input).db_state
  ASSERT cors_allows_localhost_5173()
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many random chunk configurations to verify `calculate_confidence` thresholds
- It generates arbitrary strings to verify `build_preview` truncation behavior
- It catches edge cases (empty lists, boundary similarities, exact-length strings) that manual tests miss
- It provides strong guarantees that utility function behavior is unchanged

**Test Plan**: Capture the behavior of `calculate_confidence`, `format_sources`, and `build_preview` on the unfixed code using many random inputs, then write property-based tests asserting identical behavior after the fix.

**Test Cases**:
1. **Confidence Calculation Preservation**: Generate random lists of chunks with varying similarities and verify confidence level/reason matches original logic
2. **Source Formatting Preservation**: Generate random chunk dicts and verify output format matches original
3. **Preview Truncation Preservation**: Generate random strings of varying lengths and verify truncation behavior matches original
4. **Upload Result Preservation**: Verify that uploaded documents still have correct chunk records with valid embeddings
5. **Local CORS Preservation**: Verify requests from `http://localhost:5173` continue to succeed

### Unit Tests

- Test `calculate_confidence` with empty list, all-low similarities, mixed, all-high scenarios
- Test `format_sources` with various chunk structures including missing fields
- Test `build_preview` with strings of length 0, 280, 281, and 1000
- Test `verify_api_key` rejects missing, empty, and invalid keys
- Test `verify_api_key` accepts valid key
- Test `create_embeddings_batch` correctly batches and returns correct number of embeddings
- Test file deletion logic handles missing files gracefully

### Property-Based Tests

- Generate random lists of chunk dicts with `similarity` in [0.0, 1.0] and verify `calculate_confidence` output matches threshold rules
- Generate random chunk dicts and verify `format_sources` output always contains required keys with correct types
- Generate random strings and verify `build_preview` output is ≤283 chars (280 + "...") and matches truncation rule
- Generate random batch sizes and verify `create_embeddings_batch` produces one embedding per input text
- Generate random origin strings and verify CORS configuration only allows configured origins

### Integration Tests

- Test full upload flow with batched embeddings produces identical DB state to sequential
- Test document deletion removes both DB records and file from disk
- Test authenticated request flow end-to-end (valid key → success, invalid key → 401)
- Test CORS preflight responses contain correct origin headers for allowed and disallowed origins
- Test chat endpoint uses imported `calculate_confidence` (not a local copy) by verifying behavior matches `response_utils.py`
