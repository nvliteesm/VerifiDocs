import { FileText, Sparkles } from "lucide-react";
import UploadBox from "./uploadBox";
import DocumentList from "./documentList";

function Sidebar({
  documents,
  selectedDocumentId,
  uploading,
  loadingDocs,
  onUpload,
  onSelectDocument,
  onDeleteDocument,
}) {
  const selectedDocument = documents.find((doc) => doc.id === selectedDocumentId);

  return (
    <aside className="sidebar-scroll sticky top-0 hidden h-screen w-80 shrink-0 overflow-y-auto border-r border-slate-200/80 bg-white/95 p-5 shadow-[8px_0_30px_rgba(15,23,42,0.03)] md:block">
      <div className="mb-7">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm">
          <Sparkles className="h-5 w-5" />
        </div>

        <h1 className="text-xl font-bold tracking-tight text-slate-950">
          AskDocs AI
        </h1>

        <p className="mt-2 text-sm leading-6 text-slate-500">
          Upload PDFs, ask questions, and get grounded answers with source
          evidence.
        </p>
      </div>

      <div className="mb-6 rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          Upload document
        </p>

        <UploadBox uploading={uploading} onUpload={onUpload} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium text-slate-500">Documents</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">
            {documents.length}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium text-slate-500">Scope</p>
          <p className="mt-2 truncate text-sm font-semibold text-slate-950">
            {selectedDocument ? "Single PDF" : "All PDFs"}
          </p>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-500" />
          <p className="text-sm font-semibold text-slate-800">Library</p>
        </div>

        {loadingDocs && (
          <span className="text-xs font-medium text-slate-400">
            Loading...
          </span>
        )}
      </div>

      <DocumentList
        documents={documents}
        selectedDocumentId={selectedDocumentId}
        loadingDocs={loadingDocs}
        onSelectDocument={onSelectDocument}
        onDeleteDocument={onDeleteDocument}
      />
    </aside>
  );
}

export default Sidebar;