import { Loader2, MessageSquare, Send } from "lucide-react";

function ChatPanel({ question, setQuestion, asking, onAsk }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-blue-600" />
        <h3 className="font-semibold">Ask a question</h3>
      </div>

      <form onSubmit={onAsk} className="flex gap-3">
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Example: What is this document mainly about?"
          className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          disabled={asking}
        />

        <button
          type="submit"
          disabled={asking}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
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
    </div>
  );
}

export default ChatPanel;