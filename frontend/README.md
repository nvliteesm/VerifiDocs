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
VITE_API_KEY=your-demo-access-key
```

`VITE_API_KEY` is visible in the browser bundle. It should match the backend `API_KEY` for portfolio demo gating only, not secure production authentication.

## Run Locally

```powershell
npm install
npm run dev
```
