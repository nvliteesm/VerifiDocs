import { useEffect, useState } from "react";
import { askQuestion, getChatHistory, clearChatHistory } from "../api/client";
import { useAppContext } from "../context/AppContext";
import ChatPanel from "../components/ChatPanel";
import AnswerPanel from "../components/AnswerPanel";
import ChatHistory from "../components/ChatHistory";
import DocumentDetails from "../components/DocumentDetails";
import EmptyState from "../components/EmptyState";

function ChatPage() {
  const { documents, selectedDocumentId, selectedDocument, loadingDocs, error, setError } =
    useAppContext();

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [confidence, setConfidence] = useState("");
  const [confidenceReason, setConfidenceReason] = useState("");
  const [sources, setSources] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [asking, setAsking] = useState(false);

  async function loadChatHistory(documentId = selectedDocumentId) {
    try {
      setLoadingHistory(true);

      const data = await getChatHistory(documentId);
      setChatHistory(data.messages || []);
    } catch (err) {
      console.error(err);
      setError("Failed to load chat history.");
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    loadChatHistory(selectedDocumentId);
    // Reset answer state when document changes
    setAnswer(null);
    setConfidence("");
    setConfidenceReason("");
    setSources([]);
  }, [selectedDocumentId]);

  async function handleAsk(event) {
    event.preventDefault();

    const trimmedQuestion = question.trim();

    if (!trimmedQuestion) {
      setError("Please enter a question.");
      return;
    }

    try {
      setAsking(true);
      setError("");
      setAnswer(null);
      setConfidence("");
      setConfidenceReason("");
      setSources([]);

      const data = await askQuestion({
        question: trimmedQuestion,
        documentId: selectedDocumentId,
      });

      setAnswer(data.answer || "");
      setConfidence(data.confidence || "");
      setConfidenceReason(data.confidence_reason || "");
      setSources(data.sources || data.citations || []);

      await loadChatHistory(selectedDocumentId);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || "Failed to get an answer.");
    } finally {
      setAsking(false);
    }
  }

  async function handleClearHistory() {
    try {
      setClearingHistory(true);
      setError("");

      await clearChatHistory(selectedDocumentId);
      setChatHistory([]);
    } catch (err) {
      console.error(err);
      setError("Failed to clear chat history.");
    } finally {
      setClearingHistory(false);
    }
  }

  if (documents.length === 0 && !loadingDocs) {
    return <EmptyState />;
  }

  return (
    <>
      <DocumentDetails
        document={selectedDocument}
        historyCount={chatHistory.length}
      />

      <ChatPanel
        question={question}
        setQuestion={setQuestion}
        asking={asking}
        onAsk={handleAsk}
      />

      <AnswerPanel
        asking={asking}
        answer={answer}
        confidence={confidence}
        confidenceReason={confidenceReason}
        sources={sources}
        question={question}
        documentId={selectedDocumentId}
      />

      <ChatHistory
        messages={chatHistory}
        loading={loadingHistory}
        clearing={clearingHistory}
        onClear={handleClearHistory}
      />
    </>
  );
}

export default ChatPage;
