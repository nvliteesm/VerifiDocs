function getMatchStrength(similarity) {
  if (!similarity) {
    return {
      label: "Unknown match",
      className: "bg-slate-100 text-slate-600",
    };
  }

  if (similarity >= 0.6) {
    return {
      label: "Strong match",
      className: "bg-emerald-50 text-emerald-700",
    };
  }

  if (similarity >= 0.4) {
    return {
      label: "Relevant match",
      className: "bg-blue-50 text-blue-700",
    };
  }

  return {
    label: "Weak match",
    className: "bg-amber-50 text-amber-700",
  };
}

function SourceCard({ source, index }) {
  const matchStrength = getMatchStrength(source.similarity);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="rounded-full bg-slate-100 px-2 py-1 font-medium">
          Source {index + 1}
        </span>

        {source.filename && <span>{source.filename}</span>}

        {source.page_number && <span>Page {source.page_number}</span>}

        <span
          className={`rounded-full px-2 py-1 font-medium ${matchStrength.className}`}
        >
          {matchStrength.label}
        </span>

        {typeof source.similarity === "number" && (
          <span className="text-slate-400">
            Score {source.similarity.toFixed(2)}
          </span>
        )}
      </div>

      <p className="text-sm leading-6 text-slate-700">
        {source.preview ||
          source.text ||
          source.content ||
          "No preview available."}
      </p>
    </div>
  );
}

export default SourceCard;