# VerifiDocs Frontend

React and Vite frontend for VerifiDocs.

## Features

- Upload PDF documents
- Select uploaded documents or ask across all documents
- Ask questions about document content
- Display grounded AI answers
- Show confidence labels, confidence reasons, and source snippets
- View persistent chat history
- Manage evaluation tests
- Delete uploaded documents

## Environment Variables

Create `frontend/.env` from `frontend/.env.example`:

```env
VITE_API_URL=http://127.0.0.1:8000
```

## Run Locally

```powershell
npm install
npm run dev
```
