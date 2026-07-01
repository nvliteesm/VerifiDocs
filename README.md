# VerifiDocs

VerifiDocs is a full-stack RAG-powered document assistant for uploaded PDFs. It extracts document text, chunks it, stores Gemini embeddings in Supabase Postgres with pgvector, retrieves relevant evidence, and generates grounded answers with source snippets so users can compare AI responses against the document context.

This portfolio project demonstrates a practical React and FastAPI application with document ingestion, vector search, grounded question answering, persistent chat history, and a lightweight evaluation workflow for testing RAG quality.

This project is deployed as a portfolio demo and is not intended for confidential or production document processing.

## Features

- PDF upload with file type and size validation
- PDF text extraction with PyMuPDF
- Text cleaning and token-based chunking with overlap
- Gemini embedding generation for document chunks and user questions
- Supabase Postgres storage with pgvector similarity retrieval
- Grounded answers generated from retrieved document context
- Source snippets with page numbers and similarity labels
- Confidence labels with confidence reasons
- Persistent chat history per selected document, plus all-document chat history
- Document listing, search, detail view, chunk view endpoint, and deletion
- Accuracy testing workflow for saving RAG answers, re-running evaluation, and marking human review results

## Tech Stack

**Frontend:** React, Vite, Tailwind CSS, Axios, Lucide React

**Backend:** FastAPI, Python, Pydantic, PyMuPDF, tiktoken

**Data and AI:** Supabase Postgres, pgvector, Gemini embeddings, Gemini answer generation

## Architecture

1. The React frontend uploads a PDF to the FastAPI backend.
2. The backend saves the uploaded file locally, extracts page text with PyMuPDF, cleans the text, and chunks it with token overlap.
3. Each chunk is embedded with Gemini using `gemini-embedding-001`.
4. Document metadata and chunk embeddings are stored in Supabase Postgres.
5. A user question is embedded with Gemini and sent to the Supabase `match_document_chunks` RPC.
6. Supabase uses pgvector similarity search to return the most relevant chunks, optionally scoped to one document.
7. FastAPI builds a grounded prompt from the retrieved chunks and asks Gemini to answer using only that context.
8. The frontend displays the answer, confidence label, confidence reason, source snippets, and chat history.
9. The accuracy testing panel can save generated answers with source evidence, run an evaluator, and store human review status for manual quality checks.

## Project Structure

```txt
repo-root/
  backend/
    app/
      api/routes/
        chat.py
        documents.py
        accuracy_tests.py
      core/config.py
      db/supabase.py
      models/
      rag/
      main.py
    requirements.txt

  frontend/
    src/
      api/client.js
      components/
      App.jsx
      index.css

  docs/
    supabase-setup.md
    dashboard.png
    chat-answer.png
    evaluation.png

  demo-documents/
    vendor-security-review.txt
    policy-change-brief.txt
```

## Setup

### Prerequisites

- Python 3.11+
- Node.js 20+
- Supabase project with the pgvector extension enabled
- Gemini API key

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Fill in `backend/.env`:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GEMINI_API_KEY=your-gemini-api-key
API_KEY=your-demo-access-key
CORS_ALLOWED_ORIGINS=http://localhost:5173
```

`API_KEY` is a simple demo access key checked by the FastAPI backend. It is acceptable for controlled portfolio gating, but it is not user authentication and should not be treated as production security.

Set up the Supabase tables and RPC from [docs/supabase-setup.md](docs/supabase-setup.md), then start the API:

```powershell
uvicorn app.main:app --reload
```

The backend runs at `http://127.0.0.1:8000` by default. Open API docs at `http://127.0.0.1:8000/docs`.

### Frontend

```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```

Fill in `frontend/.env`:

```env
VITE_API_URL=http://127.0.0.1:8000
VITE_API_KEY=your-demo-access-key
```

`VITE_API_KEY` is public because Vite bundles it into the browser. Use the same value as backend `API_KEY` for the demo gate only; do not use it for confidential or production authentication.

### CORS for Deployment

The backend reads `CORS_ALLOWED_ORIGINS` as a comma-separated list and trims whitespace. For Railway deployment, set it to the exact Vercel frontend origin instead of `*`:

```env
CORS_ALLOWED_ORIGINS=https://your-vercel-app.vercel.app
```

For local development, keep:

```env
CORS_ALLOWED_ORIGINS=http://localhost:5173
```

## API Overview

The backend mounts these routes:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/` | Backend status message |
| `GET` | `/health` | Health check |
| `GET` | `/documents` | List uploaded documents |
| `POST` | `/documents/upload` | Upload and process a PDF |
| `GET` | `/documents/{document_id}` | Get document metadata |
| `GET` | `/documents/{document_id}/chunks` | List stored chunks for a document |
| `DELETE` | `/documents/{document_id}` | Delete a document |
| `POST` | `/chat` | Ask a grounded question across one document or all documents |
| `GET` | `/chat/history?document_id={id}` | Get chat history for a document or all-document scope |
| `DELETE` | `/chat/history?document_id={id}` | Clear chat history for a document or all-document scope |
| `GET` | `/accuracy-tests?document_id={id}` | List saved accuracy tests, optionally scoped to a document |
| `POST` | `/accuracy-tests` | Save an answer as an accuracy test and run evaluator scoring |
| `GET` | `/accuracy-tests/summary` | Get aggregate accuracy testing metrics |
| `POST` | `/accuracy-tests/{test_id}/evaluate` | Re-run evaluator scoring for a saved accuracy test |
| `PATCH` | `/accuracy-tests/{test_id}/review` | Save a human approval or rejection review for an accuracy test |

## Screenshots

- Dashboard: `docs/dashboard.png`
- Chat answer with sources: `docs/chat-answer.png`
- Accuracy testing workflow: `docs/evaluation.png`

## Demo Documents

Safe sample content is available in [`demo-documents/`](demo-documents/). These files are fictional and do not contain confidential, personal, financial, or regulated information.

The current app upload flow accepts PDFs, so convert one of the text samples to PDF before uploading it to the public demo. For example, open the text file locally and print or export it as a PDF named `vendor-security-review.pdf` or `policy-change-brief.pdf`.

Suggested recruiter demo questions:

- What is this document about?
- Summarize the key points.
- What are the main risks mentioned?
- Which page supports this answer?

Use the accuracy testing tab after a chat response to save the answer, evaluator judgment, confidence score, and human review status.

## Supabase Setup

See [docs/supabase-setup.md](docs/supabase-setup.md) for the inferred schema, cascade relationships, pgvector index, and `match_document_chunks` RPC required by the current backend.

## Backend Tests

Backend tests can be run without real Supabase, Gemini, or API credentials:

```powershell
cd backend
python -m pip install -r requirements.txt
pytest
```

`backend/tests/conftest.py` supplies dummy test settings before app modules are imported. `backend/.env.test.example` documents the same test-safe values. In test mode, token counting uses a deterministic local fallback instead of requiring `tiktoken` to download encoding data.

## Deployment

This deployment setup is intended for a controlled portfolio demo, not a production SaaS launch.

### Backend on Railway

1. Create a Railway project from the `backend/` directory.
2. Set the Railway start command to:

```powershell
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

3. Add these Railway environment variables:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
GEMINI_API_KEY=your-gemini-api-key
API_KEY=your-demo-access-key
CORS_ALLOWED_ORIGINS=https://your-vercel-app.vercel.app
```

`SUPABASE_SERVICE_ROLE_KEY` must stay backend-only. Do not expose it in Vercel, frontend code, screenshots, logs, or committed files.

### Frontend on Vercel

1. Create a Vercel project from the `frontend/` directory.
2. Use the Vite defaults:
   - Build command: `npm run build`
   - Output directory: `dist`
3. Add these Vercel environment variables:

```env
VITE_API_URL=https://your-railway-backend-url
VITE_API_KEY=your-demo-access-key
```

`VITE_API_KEY` is public because it is bundled into the browser. It should match backend `API_KEY` only to reduce casual demo access; it is not secure authentication.

### Deployment Safety Notes

- Do not commit `.env` files.
- Do not expose `SUPABASE_SERVICE_ROLE_KEY` outside Railway/backend runtime secrets.
- Do not set production `CORS_ALLOWED_ORIGINS` to `*`.
- Use only non-confidential documents in the public demo.
- Rotate the demo `API_KEY` if it appears in logs, screen recordings, or public issue trackers.

## Current Limitations

- PDF extraction is text-based. Scanned or image-only PDFs need OCR, which is not implemented.
- Uploaded files are stored in a local `uploads/` directory during processing; durable object storage is not implemented.
- The app currently uses a Supabase service role key from the backend and does not include authentication or per-user isolation.
- Local CORS defaults to the Vite dev origin; deployment should set the exact Vercel frontend origin.
- Retrieval quality depends on PDF text quality, chunking, embedding quality, and similarity thresholds.
- Evaluation results are reviewed manually; there is no automated grading.

## Production Roadmap

- Real user authentication
- Per-user document ownership
- Supabase Storage, S3, or R2 for uploaded files
- Per-user quotas
- Stronger abuse protection
- Database row-level security
- Production logging and monitoring
- Privacy policy and terms
- OCR support for scanned PDFs
- Retrieval tuning based on accuracy test results
