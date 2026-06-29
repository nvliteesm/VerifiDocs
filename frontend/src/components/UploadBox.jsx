import { Loader2, UploadCloud } from "lucide-react";

function UploadBox({ uploading, onUpload }) {
  return (
    <label
      className={`group flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-5 text-center transition ${
        uploading
          ? "border-slate-300 bg-slate-100 text-slate-500"
          : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
      }`}
    >
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm transition group-hover:-translate-y-0.5">
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <UploadCloud className="h-5 w-5" />
        )}
      </div>

      <p className="text-sm font-semibold">
        {uploading ? "Uploading PDF..." : "Upload PDF"}
      </p>

      <p className="mt-1 text-xs leading-5 text-slate-500">
        Drag-style upload area for PDF documents.
      </p>

      <input
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={onUpload}
        disabled={uploading}
      />
    </label>
  );
}

export default UploadBox;