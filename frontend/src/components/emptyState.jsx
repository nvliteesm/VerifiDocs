import { FileText } from "lucide-react";

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
        <FileText className="h-6 w-6 text-slate-500" />
      </div>

      <h3 className="text-base font-semibold text-slate-900">
        Upload your first document
      </h3>

      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
        Add a PDF to start asking questions. AskDocs AI will retrieve relevant
        sections and answer using your document as context.
      </p>
    </div>
  );
}

export default EmptyState;