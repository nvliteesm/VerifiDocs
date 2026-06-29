import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  FileText,
  Loader2,
  Search,
  Trash2,
  X,
} from "lucide-react";

function formatDate(value) {
  if (!value) return "Unknown date";

  return new Date(value).toLocaleDateString([], {
    dateStyle: "medium",
  });
}

function DocumentList({
  documents,
  selectedDocumentId,
  loadingDocs,
  onSelectDocument,
  onDeleteDocument,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [documentToDelete, setDocumentToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const filteredDocuments = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    if (!normalizedSearch) return documents;

    return documents.filter((doc) =>
      doc.filename?.toLowerCase().includes(normalizedSearch)
    );
  }, [documents, searchTerm]);

  async function handleConfirmDelete() {
    if (!documentToDelete) return;

    try {
      setDeleting(true);
      await onDeleteDocument(documentToDelete.id);
      setDocumentToDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Documents</h2>

        {loadingDocs && (
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        )}
      </div>

      {documents.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />

            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search documents..."
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />

            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

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
        ) : filteredDocuments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-700">
              No matching documents
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Try searching with another filename.
            </p>
          </div>
        ) : (
          filteredDocuments.map((doc) => {
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

                      {doc.created_at && (
                        <>
                          <span className="text-slate-300">•</span>
                          <span>{formatDate(doc.created_at)}</span>
                        </>
                      )}

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
                  onClick={() => setDocumentToDelete(doc)}
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

      {documentToDelete &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/60 px-5 backdrop-blur-md">
            <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl sm:max-w-md sm:p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                <AlertTriangle className="h-6 w-6" />
              </div>

              <h3 className="text-lg font-bold text-slate-950">
                Delete document?
              </h3>

              <p className="mt-2 text-sm leading-6 text-slate-500">
                This will remove the PDF, extracted chunks, and related chat
                history. This action cannot be undone.
              </p>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p
                  title={documentToDelete.filename}
                  className="truncate text-sm font-semibold text-slate-900"
                >
                  {documentToDelete.filename}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {documentToDelete.total_pages
                    ? `${documentToDelete.total_pages} pages`
                    : "PDF document"}
                </p>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setDocumentToDelete(null)}
                  disabled={deleting}
                  className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={deleting}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Delete document
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

export default DocumentList;