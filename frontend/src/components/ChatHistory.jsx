import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Clock, Loader2, Trash2 } from "lucide-react";

function formatDate(value) {
  if (!value) return "";

  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function ChatHistory({
  messages,
  loading,
  clearing,
  onClear,
}) {
  if (loading) {
    return (
      <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_18px_45px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading chat history...
        </div>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-3xl border border-slate-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.04)]">
      <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/70 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Chat history
          </p>
          <h3 className="mt-1 text-base font-bold text-slate-950">
            Previous questions for this scope
          </h3>
        </div>

        {messages.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            disabled={clearing}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {clearing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Clear history
          </button>
        )}
      </div>

      <div className="p-6">
        {messages.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
            No saved questions yet. Ask something and it will appear here.
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <article
                key={message.id}
                className="rounded-2xl border border-slate-200 bg-white p-5"
              >
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Question
                    </p>
                    <h4 className="mt-1 font-semibold text-slate-950">
                      {message.question}
                    </h4>
                  </div>

                  <div className="flex shrink-0 items-center gap-1 text-xs text-slate-400">
                    <Clock className="h-3.5 w-3.5" />
                    {formatDate(message.created_at)}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="prose prose-slate max-w-none prose-p:leading-7 prose-p:text-slate-700 prose-li:text-slate-700 prose-strong:text-slate-950">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.answer}
                    </ReactMarkdown>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-semibold capitalize">
                    {message.confidence?.replace("_", " ")}
                  </span>

                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-semibold">
                    {message.sources?.length || 0} sources
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default ChatHistory;