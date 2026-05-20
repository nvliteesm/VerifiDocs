import { useEffect, useState } from "react";
import {
  uploadDocument,
  getDocuments,
  deleteDocument,
  askQuestion,
} from "./api/client";
import Sidebar from "./components/sidebar";
import UploadBox from "./components/uploadBox";
import ChatPanel from "./components/chatPanel";
import AnswerPanel from "./components/answerPanel";
import EmptyState from "./components/emptyState";
import "./index.css";

function App() {
  const [documents, setDocuments] = useState([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [sources, setSources] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [error, setError] = useState("");

  async function loadDocuments() {
    try {
      setLoadingDocs(true);
      setError("");

      const data = await getDocuments();
      setDocuments(data.documents || data || []);
    } catch (err) {
      console.error(err);
      setError("Failed to load documents.");
    } finally {
      setLoadingDocs(false);
    }
  }

  useEffect(() => {
    loadDocuments();
  }, []);

  function handleSelectDocument(documentId) {
    setSelectedDocumentId(documentId);
    setAnswer(null);
    setSources([]);
  }

  async function handleUpload(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    if (file.type !== "application/pdf") {
      setError("Only PDF files are supported.");
      return;
    }

    try {
      setUploading(true);
      setError("");

      const uploaded = await uploadDocument(file);

      await loadDocuments();

      if (uploaded?.document_id || uploaded?.id) {
        setSelectedDocumentId(uploaded.document_id || uploaded.id);
      }
    } catch (err) {
      console.error(err);
      setError(
        err.response?.data?.detail || "Upload failed. Please try again."
      );
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function handleDeleteDocument(documentId) {
    try {
      setError("");

      await deleteDocument(documentId);

      if (selectedDocumentId === documentId) {
        setSelectedDocumentId("");
        setAnswer(null);
        setSources([]);
      }

      await loadDocuments();
    } catch (err) {
      console.error(err);
      setError("Failed to delete document.");
    }
  }

  async function handleAsk(event) {
    event.preventDefault();

    const trimmedQuestion = question.trim();

    if (!trimmedQuestion) {
      setError("Please enter a question.");
      return;
    }

    try {
      setAsking(true);
      setError("");
      setAnswer(null);
      setSources([]);

      const data = await askQuestion({
        question: trimmedQuestion,
        documentId: selectedDocumentId,
      });

      setAnswer(data.answer || "");
      setSources(data.sources || data.citations || []);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || "Failed to get an answer.");
    } finally {
      setAsking(false);
    }
  }

  const selectedDocument = documents.find(
    (doc) => doc.id === selectedDocumentId
  );

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-7xl">
        <Sidebar
          documents={documents}
          selectedDocumentId={selectedDocumentId}
          uploading={uploading}
          loadingDocs={loadingDocs}
          onUpload={handleUpload}
          onSelectDocument={handleSelectDocument}
          onDeleteDocument={handleDeleteDocument}
        />

        <section className="flex flex-1 flex-col">
          <header className="border-b border-slate-200 bg-white px-5 py-4">
            <div className="mx-auto max-w-4xl">
              <p className="text-sm text-slate-500">Current document</p>
              <h2 className="mt-1 truncate text-lg font-semibold">
                {selectedDocument
                  ? selectedDocument.filename
                  : "Ask across your uploaded documents"}
              </h2>
            </div>
          </header>

          <div className="flex-1 px-5 py-8">
            <div className="mx-auto max-w-4xl">
              <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:hidden">
                <UploadBox uploading={uploading} onUpload={handleUpload} />

                <select
                  value={selectedDocumentId}
                  onChange={(event) => {
                    handleSelectDocument(event.target.value);
                  }}
                  className="mt-4 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">All uploaded documents</option>

                  {documents.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.filename}
                    </option>
                  ))}
                </select>
              </div>

              {error && (
                <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              {documents.length === 0 && !loadingDocs ? (
                <EmptyState />
              ) : (
                <>
                  <ChatPanel
                    question={question}
                    setQuestion={setQuestion}
                    asking={asking}
                    onAsk={handleAsk}
                  />

                  <AnswerPanel
                    asking={asking}
                    answer={answer}
                    sources={sources}
                  />
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default App;