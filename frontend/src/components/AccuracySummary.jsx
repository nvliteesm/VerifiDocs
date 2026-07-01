import { useCallback, useEffect, useState } from "react";
import { AlertCircle, BarChart3, Loader2, RefreshCw } from "lucide-react";
import { getAccuracyTestSummary } from "../api/client";

function AccuracySummary({ refreshTrigger }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchSummary = useCallback(async function fetchSummary() {
    try {
      setError("");
      setLoading(true);
      const data = await getAccuracyTestSummary();
      setSummary(data);
    } catch (err) {
      console.error(err);
      setError(
        err.response?.data?.detail ||
          err.message ||
          "Failed to load accuracy summary."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary, refreshTrigger]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading summary...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
        <div className="flex items-start gap-3 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p>{error}</p>
            <button
              onClick={fetchSummary}
              className="mt-2 inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!summary) return null;

  const metrics = [
    {
      label: "Total",
      value: summary.total_tests,
      border: "border-slate-200",
      bg: "bg-slate-50",
      text: "text-slate-700",
      labelText: "text-slate-500",
    },
    {
      label: "Likely Correct",
      value: summary.likely_correct_count,
      border: "border-green-200",
      bg: "bg-green-50",
      text: "text-green-700",
      labelText: "text-green-600",
    },
    {
      label: "Needs Review",
      value: summary.needs_review_count,
      border: "border-amber-200",
      bg: "bg-amber-50",
      text: "text-amber-700",
      labelText: "text-amber-600",
    },
    {
      label: "Incorrect",
      value: summary.incorrect_count,
      border: "border-red-200",
      bg: "bg-red-50",
      text: "text-red-700",
      labelText: "text-red-600",
    },
    {
      label: "Approved",
      value: summary.human_approved_count,
      border: "border-emerald-200",
      bg: "bg-emerald-50",
      text: "text-emerald-700",
      labelText: "text-emerald-600",
    },
    {
      label: "Rejected",
      value: summary.human_rejected_count,
      border: "border-rose-200",
      bg: "bg-rose-50",
      text: "text-rose-700",
      labelText: "text-rose-600",
    },
    {
      label: "Avg Confidence",
      value:
        summary.average_confidence != null
          ? `${(summary.average_confidence * 100).toFixed(0)}%`
          : "—",
      border: "border-indigo-200",
      bg: "bg-indigo-50",
      text: "text-indigo-700",
      labelText: "text-indigo-600",
    },
  ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
          <BarChart3 className="h-3.5 w-3.5" />
          Accuracy Summary
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className={`rounded-2xl border ${metric.border} ${metric.bg} px-3 py-2 text-center`}
          >
            <p className={`text-lg font-semibold ${metric.text}`}>
              {metric.value}
            </p>
            <p
              className={`text-[0.65rem] font-medium uppercase tracking-wide ${metric.labelText}`}
            >
              {metric.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default AccuracySummary;
