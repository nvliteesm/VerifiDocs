import { Loader2, MessageSquare, Send, WandSparkles } from "lucide-react";

const suggestedQuestions = [
  "What is this document about?",
  "Summarize the key points.",
  "What are the main requirements?",
];

function ChatPanel({ question, setQuestion, asking, onAsk }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.04)]">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
            <WandSparkles className="h-3.5 w-3.5" />
            Document Q&A
          </div>

          <h3 className="text-lg font-bold tracking-tight text-slate-950">
            Ask your document anything
          </h3>

          <p className="mt-1 text-sm leading-6 text-slate-500">
            Answers are generated from your uploaded PDFs and linked back to
            retrieved source snippets.
          </p>
        </div>

        <div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white sm:flex">
          <MessageSquare className="h-5 w-5" />
        </div>
      </div>

      <form onSubmit={onAsk} className="flex flex-col gap-3 sm:flex-row">
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask something like: What are the key points?"
          className="min-h-12 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-100"
          disabled={asking}
        />

        <button
          type="submit"
          disabled={asking}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-60"
        >
          {asking ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Asking
            </>
          ) : (
            <>
              <Send className="h-4 w-4" />
              Ask
            </>
          )}
        </button>
      </form>

      <div className="mt-4 flex flex-wrap gap-2">
        {suggestedQuestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => setQuestion(suggestion)}
            disabled={asking}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </section>
  );
}

export default ChatPanel;