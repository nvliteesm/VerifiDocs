import { FileText, Search, UploadCloud } from "lucide-react";

function EmptyState() {
  return (
    <section className="overflow-hidden rounded-3xl border border-dashed border-slate-300 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.04)]">
      <div className="bg-slate-50/80 px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          Start here
        </p>
        <h3 className="mt-1 text-lg font-bold text-slate-950">
          Upload your first document
        </h3>
      </div>

      <div className="p-8 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-900 text-white shadow-sm">
          <FileText className="h-7 w-7" />
        </div>

        <p className="mx-auto max-w-md text-sm leading-7 text-slate-500">
          Add a PDF to start asking questions. VerifiDocs will retrieve relevant
          sections and answer using your document as context.
        </p>

        <div className="mx-auto mt-6 grid max-w-lg gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
            <UploadCloud className="mb-3 h-5 w-5 text-slate-600" />
            <p className="text-sm font-semibold text-slate-900">
              Upload PDFs
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Store documents and prepare them for retrieval.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
            <Search className="mb-3 h-5 w-5 text-slate-600" />
            <p className="text-sm font-semibold text-slate-900">
              Ask questions
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Get grounded answers with source snippets.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default EmptyState;
