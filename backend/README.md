# VerifiDocs Backend

FastAPI backend for VerifiDocs, a RAG-powered PDF document assistant that returns grounded answers with source evidence.

## Tech Stack

- FastAPI
- Supabase Postgres
- pgvector
- Gemini embeddings and answer generation
- PyMuPDF
- Pydantic

## Environment Variables

Create `backend/.env` from `backend/.env.example`:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GEMINI_API_KEY=your-gemini-api-key
API_KEY=your-demo-access-key
CORS_ALLOWED_ORIGINS=http://localhost:5173
```

For a deployed portfolio demo, set `CORS_ALLOWED_ORIGINS` to the exact Vercel frontend origin, for example `https://your-vercel-app.vercel.app`. Do not use `*` for the public deployment.

`API_KEY` is only a simple demo access gate. It is not production authentication.

## Run Locally

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open API docs at `http://127.0.0.1:8000/docs`.

## Run Tests

Tests install from the same backend requirements:

```powershell
cd backend
python -m pip install -r requirements.txt
pytest
```

The test suite sets safe dummy credentials in `tests/conftest.py`, so test collection does not require real Supabase or Gemini credentials. See `.env.test.example` if you want an explicit local test env file.

Token counting uses a deterministic local fallback when `VERIFIDOCS_TESTING=1`, so tests do not need internet access for `tiktoken` encoding data.
