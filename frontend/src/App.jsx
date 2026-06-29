import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { MessageSquare, ClipboardCheck } from "lucide-react";
import { AppProvider, useAppContext } from "./context/AppContext";
import Sidebar from "./components/sidebar";
import UploadBox from "./components/uploadBox";
import ChatPage from "./pages/ChatPage";
import EvaluationPage from "./pages/EvaluationPage";
import "./index.css";

function AppLayout() {
  const {
    documents,
    selectedDocumentId,
    selectedDocument,
    uploading,
    loadingDocs,
    error,
    handleSelectDocument,
    handleUpload,
    handleDeleteDocument,
  } = useAppContext();

  return (
    <main className="min-h-screen bg-[#f6f8fb] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[96rem]">
        <Sidebar
          documents={documents}
          selectedDocumentId={selectedDocumentId}
          uploading={uploading}
          loadingDocs={loadingDocs}
          onUpload={handleUpload}
          onSelectDocument={handleSelectDocument}
          onDeleteDocument={handleDeleteDocument}
        />

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/85 px-5 py-4 backdrop-blur-xl">
            <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <NavLink
                    to="/"
                    className={({ isActive }) =>
                      `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                        isActive
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100"
                      }`
                    }
                  >
                    <MessageSquare className="h-3 w-3" />
                    Chat
                  </NavLink>

                  <NavLink
                    to="/evaluation"
                    className={({ isActive }) =>
                      `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                        isActive
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100"
                      }`
                    }
                  >
                    <ClipboardCheck className="h-3 w-3" />
                    Evaluation
                  </NavLink>

                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500">
                    {selectedDocument ? "Single document" : "All documents"}
                  </span>
                </div>

                <p className="text-sm font-medium text-slate-500">
                  Current document
                </p>

                <h2
                  title={
                    selectedDocument
                      ? selectedDocument.filename
                      : "Ask across your uploaded documents"
                  }
                  className="mt-1 truncate text-xl font-bold tracking-tight text-slate-950"
                >
                  {selectedDocument
                    ? selectedDocument.filename
                    : "Ask across your uploaded documents"}
                </h2>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:w-64">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs font-medium text-slate-500">
                    Documents
                  </p>
                  <p className="mt-1 text-xl font-bold text-slate-950">
                    {documents.length}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs font-medium text-slate-500">
                    Scope
                  </p>
                  <p className="mt-1 text-sm font-bold text-slate-950">
                    {selectedDocument ? "Single PDF" : "All PDFs"}
                  </p>
                </div>
              </div>
            </div>
          </header>

          <div className="flex-1 px-5 py-8">
            <div className="mx-auto max-w-5xl">
              {/* Mobile upload + document selector */}
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

              <Routes>
                <Route path="/" element={<ChatPage />} />
                <Route path="/evaluation" element={<EvaluationPage />} />
              </Routes>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <AppLayout />
      </AppProvider>
    </BrowserRouter>
  );
}

export default App;
