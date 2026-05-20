# AskDocs AI

AskDocs AI is a document question-answering application that allows users to upload PDF files and ask questions about their contents. The system extracts text from uploaded documents, splits the content into chunks, stores vector embeddings in Supabase using pgvector, retrieves relevant document sections, and generates grounded answers with source snippets.

This project was built as a portfolio project to demonstrate backend API design, document processing, vector search, and Retrieval-Augmented Generation (RAG).

---

## Features

- Upload PDF documents
- Extract text from uploaded PDFs
- Split document text into searchable chunks
- Generate embeddings for document chunks
- Store document and chunk data in Supabase
- Search relevant chunks using vector similarity
- Ask questions about uploaded documents
- Generate AI answers grounded in retrieved context
- Show source snippets used for the answer
- Delete uploaded documents
- Basic React dashboard interface

---

## Tech Stack

### Frontend

- React
- Vite
- Tailwind CSS
- Axios
- Lucide React

### Backend

- FastAPI
- Python
- Supabase
- PostgreSQL with pgvector
- Gemini API for embeddings and answer generation
- PyMuPDF for PDF text extraction
- Pydantic for request and response validation

---

## How It Works

AskDocs AI uses a basic RAG pipeline.

1. A user uploads a PDF.
2. The backend extracts text from the PDF.
3. The extracted text is split into smaller chunks.
4. Each chunk is converted into an embedding.
5. The document metadata and chunk embeddings are stored in Supabase.
6. When the user asks a question, the question is embedded.
7. Supabase searches for the most relevant chunks using vector similarity.
8. The backend sends the relevant chunks and question to the AI model.
9. The model generates an answer using only the retrieved document context.
10. The frontend displays the answer and source snippets.

---

## Project Structure

```txt
AskDocs-AI/
  backend/
    app/
      api/
        routes/
          chat.py
          documents.py
      core/
        config.py
      db/
        supabase_client.py
      models/
        schemas.py
      rag/
        chunker.py
        embeddings.py
        generator.py
        pdf_parser.py
        retriever.py
      main.py

  frontend/
    src/
      api/
        client.js
      components/
        AnswerPanel.jsx
        ChatPanel.jsx
        DocumentList.jsx
        EmptyState.jsx
        Sidebar.jsx
        SourceCard.jsx
        UploadBox.jsx
      App.jsx
      index.css