import { useAppContext } from "../context/AppContext";
import EvaluationPanel from "../components/evaluationPanel";
import EmptyState from "../components/emptyState";

function EvaluationPage() {
  const { documents, selectedDocument, loadingDocs } = useAppContext();

  if (documents.length === 0 && !loadingDocs) {
    return <EmptyState />;
  }

  return <EvaluationPanel selectedDocument={selectedDocument} />;
}

export default EvaluationPage;
