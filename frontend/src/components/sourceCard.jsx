function SourceCard({ source, index }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="rounded-full bg-slate-100 px-2 py-1 font-medium">
          Source {index + 1}
        </span>

        {source.filename && <span>{source.filename}</span>}

        {source.page_number && <span>Page {source.page_number}</span>}

        {source.similarity && (
            <span className="rounded-full bg-green-50 px-2 py-1 font-medium text-green-700">
                Relevant match
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