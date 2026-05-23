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
```

## Run Locally

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open API docs at `http://127.0.0.1:8000/docs`.
