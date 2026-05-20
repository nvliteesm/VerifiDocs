import { Loader2, Upload } from "lucide-react";

function UploadBox({ uploading, onUpload }) {
  return (
    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-100">
      {uploading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Uploading...
        </>
      ) : (
        <>
          <Upload className="h-4 w-4" />
          Upload PDF
        </>
      )}

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