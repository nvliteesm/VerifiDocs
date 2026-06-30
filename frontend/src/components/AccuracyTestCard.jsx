import { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from "lucide-react";
import { reEvaluateAccuracyTest, reviewAccuracyTest } from "../api/client";

const FAILURE_REASONS = [
  { value: "wrong_answer", label: "Wrong Answer" },
  { value: "incomplete_answer", label: "Incomplete Answer" },
  { value: "hallucinated_answer", label: "Hallucinated Answer" },
  { value: "wrong_source_retrieved", label: "Wrong Source Retrieved" },
  { value: "no_source_found", label: "No Source Found" },
  { value: "question_unclear", label: "Question Unclear" },
];

function getStatusStyle(status) {
  switch (status) {
    case "likely_correct":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "human_approved":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "needs_review":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "incorrect":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "human_rejected":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function getStatusLabel(status) {
  switch (status) {
    case "likely_correct":
      return "Likely Correct";
    case "human_approved":
      return "Human Approved";
    case "needs_review":
      return "Needs Review";
    case "incorrect":
      return "Incorrect";
    case "human_rejected":
      return "Human Rejected";
    default:
      return status || "Unknown";
  }
}

function getJudgmentStyle(judgment) {
  switch (judgment) {
    case "supported_by_source":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "partially_supported":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "unsupported":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "possible_hallucination":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "missing_information":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "insufficient_evidence":
      return "border-slate-200 bg-slate-50 text-slate-600";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function formatJudgment(judgment) {
  if (!judgment) return "N/A";
  return judgment
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDate(dateString) {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SourceEvidencePreview({ sourceEvidence }) {
  const [expanded, setExpanded] = useState(false);

  if (!sourceEvidence || sourceEvidence.length === 0) {
    return (
      <p className="text-sm text-slate-500 italic">No source evidence</p>
    );
  }

  const firstChunk = sourceEvidence[0];
  const previewText =
    firstChunk.content || firstChunk.text || "No content available";
  const truncated =
    previewText.length > 150 ? previewText.slice(0, 150) + "..." : previewText;

  return (
    <div>
      <div className="flex items-center gap-2">
        <p className="text-sm text-slate-700">
          {expanded ? previewText : truncated}
        </p>
      </div>
      {sourceEvidence.length > 1 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" />
              +{sourceEvidence.length - 1} more chunk
              {sourceEvidence.length - 1 > 1 ? "s" : ""}
            </>
          )}
        </button>
      )}
      {expanded && sourceEvidence.length > 1 && (
        <div className="mt-2 space-y-2">
          {sourceEvidence.slice(1).map((chunk, idx) => (
            <div
              key={idx}
              className="rounded-lg border border-slate-100 bg-slate-50 p-2 text-sm text-slate-700"
            >
              {chunk.content || chunk.text || "No content"}
              {chunk.page_number && (
                <span className="ml-2 text-xs text-slate-400">
                  (p.{chunk.page_number})
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AccuracyTestCard({ test, onUpdate }) {
  const [approveLoading, setApproveLoading] = useState(false);
  const [rejectLoading, setRejectLoading] = useState(false);
  const [reEvalLoading, setReEvalLoading] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [selectedFailureReason, setSelectedFailureReason] = useState("");
  const [error, setError] = useState("");

  async function handleApprove() {
    try {
      setError("");
      setApproveLoading(true);
      await reviewAccuracyTest(test.id, {
        human_status: "human_approved",
      });
      if (onUpdate) onUpdate();
    } catch (err) {
      console.error(err);
      setError(
        err.response?.data?.detail || "Failed to approve test."
      );
    } finally {
      setApproveLoading(false);
    }
  }

  async function handleReject() {
    if (!selectedFailureReason) {
      setError("Please select a failure reason.");
      return;
    }

    try {
      setError("");
      setRejectLoading(true);
      await reviewAccuracyTest(test.id, {
        human_status: "human_rejected",
        human_notes: selectedFailureReason,
      });
      setShowRejectForm(false);
      setSelectedFailureReason("");
      if (onUpdate) onUpdate();
    } catch (err) {
      console.error(err);
      setError(
        err.response?.data?.detail || "Failed to reject test."
      );
    } finally {
      setRejectLoading(false);
    }
  }

  async function handleReEvaluate() {
    try {
      setError("");
      setReEvalLoading(true);
      await reEvaluateAccuracyTest(test.id);
      if (onUpdate) onUpdate();
    } catch (err) {
      console.error(err);
      setError(
        err.response?.data?.detail || "Failed to re-evaluate test."
      );
    } finally {
      setReEvalLoading(false);
    }
  }

  return (
    <article className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
      {/* Header: Status badge + date + actions */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusStyle(test.status)}`}
          >
            {getStatusLabel(test.status)}
          </span>

          {test.judgment && (
            <span
              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getJudgmentStyle(test.judgment)}`}
            >
              {formatJudgment(test.judgment)}
            </span>
          )}

          {test.confidence_score != null && (
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
              Confidence: {(test.confidence_score * 100).toFixed(0)}%
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleApprove}
            disabled={approveLoading || rejectLoading || reEvalLoading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
          >
            {approveLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            Approve
          </button>

          <button
            onClick={() => setShowRejectForm(!showRejectForm)}
            disabled={approveLoading || rejectLoading || reEvalLoading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
          >
            <XCircle className="h-3.5 w-3.5" />
            Reject
          </button>

          <button
            onClick={handleReEvaluate}
            disabled={approveLoading || rejectLoading || reEvalLoading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
          >
            {reEvalLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Re-evaluate
          </button>
        </div>
      </div>

      {/* Reject form */}
      {showRejectForm && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-rose-100 bg-rose-50/50 p-3">
          <select
            value={selectedFailureReason}
            onChange={(e) => setSelectedFailureReason(e.target.value)}
            className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs text-slate-700 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
          >
            <option value="">Select failure reason...</option>
            {FAILURE_REASONS.map((reason) => (
              <option key={reason.value} value={reason.value}>
                {reason.label}
              </option>
            ))}
          </select>

          <button
            onClick={handleReject}
            disabled={rejectLoading || !selectedFailureReason}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
          >
            {rejectLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <XCircle className="h-3 w-3" />
            )}
            Confirm Reject
          </button>

          <button
            onClick={() => {
              setShowRejectForm(false);
              setSelectedFailureReason("");
            }}
            className="text-xs font-medium text-slate-500 hover:text-slate-700"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Question */}
      <div className="mt-4">
        <h3 className="text-base font-semibold text-slate-950">
          {test.question}
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          {formatDate(test.created_at)}
        </p>
      </div>

      {/* Answers grid */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            AI Answer
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
            {test.ai_answer || "No AI answer."}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Reference Answer
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
            {test.reference_answer || "No reference answer generated."}
          </p>
        </div>
      </div>

      {/* Source Evidence Preview */}
      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Source Evidence
        </p>
        <div className="mt-2">
          <SourceEvidencePreview sourceEvidence={test.source_evidence} />
        </div>
      </div>

      {/* Metadata row */}
      <div className="mt-4 grid gap-3 text-sm lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Confidence
          </p>
          <p className="mt-1 font-medium text-slate-800">
            {test.confidence_score != null
              ? `${(test.confidence_score * 100).toFixed(0)}%`
              : "-"}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Judgment
          </p>
          <p className="mt-1 font-medium text-slate-800">
            {formatJudgment(test.judgment)}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Reason
          </p>
          <p className="mt-1 text-slate-700">
            {test.reason || "-"}
          </p>
        </div>
      </div>
    </article>
  );
}

export default AccuracyTestCard;
