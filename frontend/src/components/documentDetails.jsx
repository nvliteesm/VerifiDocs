import { Calendar, FileText, Layers, MessageCircle } from "lucide-react";

function formatDate(value) {
  if (!value) return "Unknown upload date";

  return new Date(value).toLocaleDateString([], {
    dateStyle: "medium",
  });
}

function DocumentDetails({ document, historyCount }) {
  if (!document) {
    return (
      <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.04)]">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          Document scope
        </p>

        <h3 className="mt-2 text-lg font-bold text-slate-950">
          Asking across all uploaded documents
        </h3>

        <p className="mt-2 text-sm leading-6 text-slate-500">
          Select a document from the sidebar to focus answers on one PDF, or
          leave no document selected to search across all uploaded documents.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-100 bg-slate-50/70 px-6 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          Selected document
        </p>

        <div className="mt-2 flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm">
            <FileText className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <h3
              title={document.filename}
              className="truncate text-lg font-bold text-slate-950"
            >
              {document.filename}
            </h3>

            <p className="mt-1 text-sm leading-6 text-slate-500">
              Answers are currently limited to this PDF.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-6 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            <Layers className="h-4 w-4" />
          </div>

          <p className="text-xs font-medium text-slate-500">Pages</p>
          <p className="mt-1 text-lg font-bold text-slate-950">
            {document.total_pages || "Unknown"}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            <Calendar className="h-4 w-4" />
          </div>

          <p className="text-xs font-medium text-slate-500">Uploaded</p>
          <p className="mt-1 text-sm font-bold text-slate-950">
            {formatDate(document.created_at)}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            <MessageCircle className="h-4 w-4" />
          </div>

          <p className="text-xs font-medium text-slate-500">Saved Q&A</p>
          <p className="mt-1 text-lg font-bold text-slate-950">
            {historyCount}
          </p>
        </div>
      </div>
    </section>
  );
}

export default DocumentDetails;