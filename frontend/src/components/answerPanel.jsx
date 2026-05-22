import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckCircle2, Loader2, Search, ShieldCheck } from "lucide-react";
import SourceCard from "./sourceCard";

function getConfidenceStyles(confidence) {
  switch (confidence) {
    case "high":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "medium":
      return "border-sky-200 bg-sky-50 text-sky-700";
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
      <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-100 bg-slate-50/70 px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Generated answer
              </p>
              <h3 className="mt-1 text-base font-bold text-slate-950">
                Response from your documents
              </h3>
            </div>

            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-200">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </div>
        </div>

        <div className="p-6">
          {asking ? (
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
              Searching your documents and generating a grounded answer...
            </div>
          ) : answer ? (
            <div className="rounded-2xl border border-slate-100 bg-white p-5">
              <div className="prose prose-slate max-w-none prose-p:leading-7 prose-p:text-slate-700 prose-li:my-1 prose-li:text-slate-700 prose-strong:text-slate-950">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {answer}
                </ReactMarkdown>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-200">
                <Search className="h-5 w-5" />
              </div>

              <h4 className="font-semibold text-slate-900">
                No answer generated yet
              </h4>

              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                Ask a question about your uploaded document. The answer will
                appear here together with confidence details and source
                evidence.
              </p>
            </div>
          )}
        </div>
      </section>

      {!asking && confidence && (
        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_18px_45px_rgba(15,23,42,0.04)]">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-slate-600" />
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
              Confidence
            </h3>
          </div>

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
        </section>
      )}

      {sources.length > 0 && (
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Retrieved evidence
              </p>
              <h3 className="mt-1 text-base font-bold text-slate-950">
                Source snippets used for this answer
              </h3>
            </div>

            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500">
              {sources.length} {sources.length === 1 ? "source" : "sources"}
            </span>
          </div>

          <div className="grid gap-3">
            {sources.map((source, index) => (
              <SourceCard
                key={`${source.chunk_id || index}`}
                source={source}
                index={index}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export default AnswerPanel;