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
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-700">
              No documents yet
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Upload a PDF to start asking document-grounded questions.
            </p>
          </div>
        ) : (
          documents.map((doc) => {
            const isSelected = selectedDocumentId === doc.id;

            return (
              <div
                key={doc.id}
                className={`group flex min-w-0 items-start gap-3 rounded-2xl border p-3 transition ${
                  isSelected
                    ? "border-slate-900 bg-slate-50 shadow-sm"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectDocument(doc.id)}
                  className="flex min-w-0 flex-1 items-start gap-3 text-left"
                >
                  <div
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                      isSelected
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    <FileText className="h-4 w-4" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p
                      title={doc.filename}
                      className="truncate text-sm font-semibold text-slate-900"
                    >
                      {doc.filename}
                    </p>

                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>
                        {doc.total_pages
                          ? `${doc.total_pages} pages`
                          : "PDF document"}
                      </span>

                      {isSelected && (
                        <span className="rounded-full bg-slate-900 px-2 py-0.5 font-medium text-white">
                          Selected
                        </span>
                      )}
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onDeleteDocument(doc.id)}
                  className="shrink-0 rounded-xl p-2 text-slate-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                  aria-label="Delete document"
                  title="Delete document"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default DocumentList;