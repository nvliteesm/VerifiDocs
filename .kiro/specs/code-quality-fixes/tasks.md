# Implementation Plan

## Overview

This task list implements five code quality fixes for the VerifiDocs backend using the exploratory bugfix workflow: write tests to confirm bugs exist, write preservation tests to guard against regressions, apply the fixes, then validate everything passes.

## Tasks

- [ ] 1. Write bug condition exploration tests
  - **Property 1: Bug Condition** - Code Quality Defects (Duplication, Auth Bypass, Sequential Embedding, Orphaned Files, CORS Wildcard)
  - **CRITICAL**: These tests MUST FAIL on unfixed code - failure confirms the bugs exist
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: These tests encode the expected behavior - they will validate the fixes when they pass after implementation
  - **GOAL**: Surface counterexamples that demonstrate each bug exists
  - **Scoped PBT Approach**: Scope properties to concrete failing cases for each defect
  - Test 1a: Verify `chat.py` defines local copies of `calculate_confidence`, `format_sources`, `build_preview` (demonstrates duplication bug exists by checking source code has duplicate definitions)
  - Test 1b: Send HTTP request to `/documents/` with no `X-API-Key` header and assert response is 401 (will FAIL on unfixed code because request succeeds with 200)
  - Test 1c: Upload a PDF with multiple chunks and assert embedding API is called fewer times than chunk count (will FAIL on unfixed code because each chunk is embedded individually)
  - Test 1d: Upload a PDF, delete the document via API, and assert the file no longer exists in `uploads/` (will FAIL on unfixed code because file remains on disk)
  - Test 1e: Assert CORS `allow_origins` is NOT `["*"]` and reads from environment config (will FAIL on unfixed code because wildcard is hardcoded)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - it proves the bugs exist)
  - Document counterexamples found:
    - Unauthenticated requests return 200 instead of 401
    - PDF files remain in `uploads/` after document deletion
    - Embedding takes O(n) calls instead of O(n/batch_size)
    - CORS allows any origin via `*`
    - `chat.py` contains duplicate function definitions
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Utility Function Behavior, Upload Pipeline, Local CORS, DB Deletion
  - **IMPORTANT**: Follow observation-first methodology
  - **Step 1 - Observe on UNFIXED code:**
  - Observe: `calculate_confidence([])` returns `{"level": "not_found", ...}` on unfixed code
  - Observe: `calculate_confidence([{"similarity": 0.65}, {"similarity": 0.50}])` returns `{"level": "high", ...}` on unfixed code
  - Observe: `calculate_confidence([{"similarity": 0.42}])` returns `{"level": "medium", ...}` on unfixed code
  - Observe: `format_sources([{"document_id": "x", "chunk_index": 0, "metadata": {"page_number": 1}, "similarity": 0.123456, "content": "hello"}])` returns properly formatted source dict on unfixed code
  - Observe: `build_preview("short text")` returns `"short text"` on unfixed code
  - Observe: `build_preview("a" * 300)` returns first 280 chars + `"..."` on unfixed code
  - Observe: Requests from `http://localhost:5173` succeed with proper CORS headers on unfixed code
  - Observe: Document deletion removes DB records (document + chunks) on unfixed code
  - **Step 2 - Write property-based tests:**
  - Property test: For all random lists of chunk dicts with `similarity` in [0.0, 1.0], `calculate_confidence` returns correct level based on thresholds (high ≥0.60 best AND ≥2 strong ≥0.45, medium ≥0.40, low otherwise, not_found <0.25 or empty)
  - Property test: For all random chunk dicts, `format_sources` output contains required keys (document_id, chunk_index, page_number, similarity, preview) with correct types
  - Property test: For all random strings, `build_preview` returns full text if ≤280 chars, or first 280 chars + "..." if longer
  - Property test: Requests from localhost:5173 continue to receive valid CORS headers
  - Property test: Document deletion still removes document and chunk records from DB
  - **Step 3 - Verify on UNFIXED code:**
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [ ] 3. Fix for code quality issues (duplication, auth, embedding, file leak, CORS)

  - [ ] 3.1 Remove duplicate functions from `chat.py` and import from canonical source
    - Delete local definitions of `calculate_confidence`, `format_sources`, and `build_preview` from `app/api/routes/chat.py`
    - Add `from app.rag.response_utils import calculate_confidence, format_sources, build_preview` at the top of `chat.py`
    - Verify all usages in `chat.py` reference the imported functions
    - _Bug_Condition: isBugCondition(input) where input.type == "code_change" AND file_has_local_copy("app/api/routes/chat.py", input.target)_
    - _Expected_Behavior: chat.py imports from app.rag.response_utils, no local definitions exist_
    - _Preservation: calculate_confidence, format_sources, build_preview produce identical outputs_
    - _Requirements: 2.1, 3.1, 3.2, 3.3_

  - [ ] 3.2 Add API key authentication
    - Create `app/api/dependencies.py` with `verify_api_key` function that checks `X-API-Key` header against `settings.api_key`
    - Add `api_key: str` field to `Settings` class in `app/core/config.py`
    - Add `API_KEY` to `.env.example`
    - Apply `Depends(verify_api_key)` to all route handlers (or as a global dependency on the app)
    - Raise `HTTPException(status_code=401, detail="Invalid or missing API key")` for invalid/missing keys
    - _Bug_Condition: isBugCondition(input) where input.type == "http_request" AND NOT input.headers.contains("X-API-Key") AND request_is_accepted(input)_
    - _Expected_Behavior: Unauthenticated requests receive 401 response_
    - _Preservation: Authenticated requests continue to work normally_
    - _Requirements: 2.2_

  - [ ] 3.3 Implement batch embedding for PDF uploads
    - Create `create_embeddings_batch(texts: list[str], task_type: str, batch_size: int = 100) -> list[list[float]]` in `app/rag/embeddings.py`
    - Use Gemini's batch embedding support to process multiple texts per API call
    - Update the upload handler in `app/api/routes/documents.py` to call `create_embeddings_batch` instead of looping with `create_embedding`
    - Ensure each chunk still receives its correct embedding vector in the same order
    - _Bug_Condition: isBugCondition(input) where input.type == "upload" AND len(input.chunks) > 1 AND embeddings_created_sequentially(input.chunks)_
    - _Expected_Behavior: embedding_api_calls < len(input.chunks), chunks batched for efficiency_
    - _Preservation: Same embedding vectors produced, same DB state after upload_
    - _Requirements: 2.3, 3.4, 3.5_

  - [ ] 3.4 Delete orphaned PDF file on document removal
    - Store the `file_path` (relative path including UUID prefix) in the document DB record during upload
    - In `delete_document` handler in `documents.py`, retrieve the stored file path
    - After successful DB deletion, remove the file from `uploads/` using `os.remove()` with `os.path.exists()` guard
    - Handle missing file gracefully (log warning, don't raise error)
    - _Bug_Condition: isBugCondition(input) where input.type == "delete" AND document_has_file(input.document_id, "uploads/") AND NOT file_removed_after_delete(input.document_id)_
    - _Expected_Behavior: File is removed from disk after successful DB deletion_
    - _Preservation: DB records (document + chunks) still deleted correctly_
    - _Requirements: 2.4, 3.7_

  - [ ] 3.5 Configure CORS origins from environment variable
    - Add `cors_allowed_origins: str = "http://localhost:5173"` field to `Settings` class in `app/core/config.py`
    - In `app/main.py`, replace `allow_origins=["*"]` with `allow_origins=settings.cors_allowed_origins.split(",")`
    - Add `CORS_ALLOWED_ORIGINS` to `.env.example` with documentation
    - Ensure local development default (`http://localhost:5173`) is preserved
    - _Bug_Condition: isBugCondition(input) where input.type == "deployment" AND input.environment != "local" AND cors_allows_origin("*")_
    - _Expected_Behavior: CORS origins read from environment, no wildcard in production_
    - _Preservation: Local dev frontend at localhost:5173 still allowed_
    - _Requirements: 2.5, 3.6_

  - [ ] 3.6 Verify bug condition exploration tests now pass
    - **Property 1: Expected Behavior** - All Five Defects Resolved
    - **IMPORTANT**: Re-run the SAME tests from task 1 - do NOT write new tests
    - The tests from task 1 encode the expected behavior for each defect
    - When these tests pass, it confirms the expected behavior is satisfied:
      - `chat.py` no longer has local duplicate functions
      - Unauthenticated requests receive 401
      - Embeddings are batched (fewer API calls than chunks)
      - Deleted document files are removed from disk
      - CORS origins come from environment config
    - Run bug condition exploration tests from step 1
    - **EXPECTED OUTCOME**: Tests PASS (confirms all bugs are fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 3.7 Verify preservation tests still pass
    - **Property 2: Preservation** - All Preserved Behaviors Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all preservation tests still pass after fixes:
      - `calculate_confidence` thresholds unchanged
      - `format_sources` output format unchanged
      - `build_preview` truncation logic unchanged
      - Upload pipeline produces same DB state
      - Local CORS still works
      - DB deletion still removes records

- [ ] 4. Checkpoint - Ensure all tests pass
  - Run the full test suite (exploration + preservation + unit + integration)
  - Verify all 5 bug condition tests PASS (confirming fixes work)
  - Verify all preservation property tests PASS (confirming no regressions)
  - Ensure no other tests in the project are broken
  - Ask the user if questions arise

## Task Dependency Graph

```json
{
  "waves": [
    ["1"],
    ["2"],
    ["3.1", "3.2", "3.3", "3.4", "3.5"],
    ["3.6", "3.7"],
    ["4"]
  ]
}
```

## Notes

- Tasks 1 and 2 MUST be completed before any implementation (task 3) begins
- Task 1 tests are expected to FAIL on unfixed code (this confirms bugs exist)
- Task 2 tests are expected to PASS on unfixed code (this captures baseline behavior)
- Sub-tasks 3.1-3.5 implement the actual fixes and can be done in any order
- Sub-tasks 3.6 and 3.7 re-run the same tests from tasks 1 and 2 to validate the fixes
- Property-based testing is used for preservation to provide stronger coverage guarantees
