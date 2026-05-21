import { Loader2 } from "lucide-react";
import SourceCard from "./sourceCard";

function getConfidenceStyles(confidence) {
  switch (confidence) {
    case "high":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "medium":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "low":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "not_found":
      return "border-slate-200 bg-slate-100 text-slate-600";
    default:
      return "border-slate-200 bg-slate-100 text-slate-600";
  }
}

function formatConfidenceLabel(confidence) {
  if (!confidence) return "";
  return confidence.replace("_", " ");
}

function AnswerPanel({ asking, answer, confidence, confidenceReason, sources }) {
  return (
    <>
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Answer
        </h3>

        {asking ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Searching documents and generating answer...
          </div>
        ) : answer ? (
          <p className="whitespace-pre-wrap leading-7 text-slate-800">
            {answer}
          </p>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
            Ask a question about your uploaded document. The answer will appear here with
            source snippets below it.
          </div>
        )}
      </div>

      {!asking && confidence && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Confidence
          </h3>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <span
              className={`inline-flex w-fit rounded-full border px-3 py-1 text-sm font-semibold capitalize ${getConfidenceStyles(
                confidence
              )}`}
            >
              {formatConfidenceLabel(confidence)}
            </span>

            {confidenceReason && (
              <p className="text-sm leading-6 text-slate-600">
                {confidenceReason}
              </p>
            )}
          </div>
        </div>
      )}

      {sources.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Retrieved Evidence
          </h3>

          <div className="grid gap-3">
            {sources.map((source, index) => (
              <SourceCard
                key={`${source.chunk_id || index}`}
                source={source}
                index={index}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default AnswerPanel;