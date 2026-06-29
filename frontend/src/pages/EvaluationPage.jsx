import { useAppContext } from "../context/AppContext";
import EvaluationPanel from "../components/EvaluationPanel";
import EmptyState from "../components/EmptyState";

function EvaluationPage() {
  const { documents, selectedDocument, loadingDocs } = useAppContext();

  if (documents.length === 0 && !loadingDocs) {
    return <EmptyState />;
  }

  return <EvaluationPanel selectedDocument={selectedDocument} />;
}

export default EvaluationPage;
