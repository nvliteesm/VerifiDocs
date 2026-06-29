import { FileSearch, Hash } from "lucide-react";

function getMatchStrength(similarity) {
  if (typeof similarity !== "number") {
    return {
      label: "Unknown match",
      className: "border-slate-200 bg-slate-100 text-slate-600",
    };
  }

  if (similarity >= 0.6) {
    return {
      label: "Strong match",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }

  if (similarity >= 0.4) {
    return {
      label: "Relevant match",
      className: "border-sky-200 bg-sky-50 text-sky-700",
    };
  }

  return {
    label: "Weak match",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  };
}

function SourceCard({ source, index }) {
  const matchStrength = getMatchStrength(source.similarity);
  const preview =
    source.preview ||
    source.text ||
    source.content ||
    "No preview available.";

  return (
    <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_14px_35px_rgba(15,23,42,0.035)]">
      <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-200">
              <FileSearch className="h-4 w-4" />
            </div>

            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">
                Source {index + 1}
              </p>

              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-slate-500">
                {source.filename && (
                  <span className="max-w-[14rem] truncate" title={source.filename}>
                    {source.filename}
                  </span>
                )}

                {source.page_number && (
                  <span>Page {source.page_number}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${matchStrength.className}`}
            >
              {matchStrength.label}
            </span>

            {typeof source.similarity === "number" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-500">
                <Hash className="h-3 w-3" />
                {source.similarity.toFixed(2)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="p-5">
        <p className="text-sm leading-7 text-slate-700">
          {preview}
        </p>
      </div>
    </article>
  );
}

export default SourceCard;