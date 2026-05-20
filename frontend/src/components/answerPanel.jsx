import { Loader2 } from "lucide-react";
import SourceCard from "./sourceCard";

function AnswerPanel({ asking, answer, sources }) {
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
          <p className="text-sm text-slate-500">
            Your answer will appear here after you ask a question.
          </p>
        )}
      </div>

      {sources.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Sources
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