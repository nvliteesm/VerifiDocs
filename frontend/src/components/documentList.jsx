import { FileText, Loader2, Trash2 } from "lucide-react";

function DocumentList({
  documents,
  selectedDocumentId,
  loadingDocs,
  onSelectDocument,
  onDeleteDocument,
}) {
  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Documents</h2>

        {loadingDocs && (
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        )}
      </div>

      <div className="space-y-2">
        {documents.length === 0 && !loadingDocs ? (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
            No documents uploaded yet.
          </p>
        ) : (
          documents.map((doc) => (
            <div
              key={doc.id}
              className={`group flex items-start gap-3 rounded-xl border p-3 transition ${
                selectedDocumentId === doc.id
                  ? "border-blue-500 bg-blue-50 shadow-sm ring-2 ring-blue-100"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectDocument(doc.id)}
                className="flex flex-1 items-start gap-3 text-left"
              >
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />

                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {doc.filename}
                  </p>

                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <span>
                        {doc.total_pages ? `${doc.total_pages} pages` : "PDF document"}
                    </span>

                    {selectedDocumentId === doc.id && (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-700">
                        Selected
                        </span>
                    )}
                </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onDeleteDocument(doc.id)}
                className="rounded-md p-1 text-slate-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                aria-label="Delete document"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default DocumentList;