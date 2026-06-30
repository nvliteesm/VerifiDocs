import { useEffect, useState } from "react";
import { Loader2, AlertCircle, RefreshCw, FlaskConical } from "lucide-react";
import AccuracySummary from "../components/AccuracySummary";
import AccuracyTestCard from "../components/AccuracyTestCard";
import { getAccuracyTests } from "../api/client";
import { useAppContext } from "../context/AppContext";

function AccuracyTestingPage() {
  const { selectedDocumentId } = useAppContext();
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  async function fetchTests() {
    try {
      setError("");
      setLoading(true);
      const data = await getAccuracyTests(selectedDocumentId);
      setTests(data);
    } catch (err) {
      console.error(err);
      setError(
        err.response?.data?.detail ||
          err.message ||
          "Failed to load accuracy tests."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTests();
  }, [selectedDocumentId]);

  function handleTestUpdate() {
    fetchTests();
    setRefreshTrigger((prev) => prev + 1);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading accuracy tests...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 shadow-sm">
        <div className="flex items-start gap-3 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">Failed to load accuracy tests</p>
            <p className="mt-1">{error}</p>
            <button
              onClick={fetchTests}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AccuracySummary refreshTrigger={refreshTrigger} />

      {tests.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <FlaskConical className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-4 text-sm font-medium text-slate-600">
            No accuracy tests yet
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Save a chat answer as an accuracy test to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {tests.map((test) => (
            <AccuracyTestCard
              key={test.id}
              test={test}
              onUpdate={handleTestUpdate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default AccuracyTestingPage;
