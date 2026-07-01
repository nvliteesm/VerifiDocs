import { useCallback, useEffect, useState } from "react";
import { getDocuments, uploadDocument, deleteDocument } from "../api/client";
import { AppContext } from "./contextValue";

export function AppProvider({ children }) {
  const [documents, setDocuments] = useState([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [error, setError] = useState("");

  const loadDocuments = useCallback(async function loadDocuments() {
    try {
      setLoadingDocs(true);
      setError("");

      const data = await getDocuments();
      setDocuments(data.documents || data || []);
    } catch (err) {
      console.error(err);
      setError("Failed to load documents.");
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  function handleSelectDocument(documentId) {
    setSelectedDocumentId(documentId);
  }

  async function handleUpload(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    if (file.type !== "application/pdf") {
      setError("Only PDF files are supported.");
      return;
    }

    try {
      setUploading(true);
      setError("");

      const uploaded = await uploadDocument(file);

      await loadDocuments();

      const uploadedDocumentId =
        uploaded?.document?.id || uploaded?.document_id || uploaded?.id;

      if (uploadedDocumentId) {
        setSelectedDocumentId(uploadedDocumentId);
      }
    } catch (err) {
      console.error(err);
      setError(
        err.response?.data?.detail || "Upload failed. Please try again."
      );
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function handleDeleteDocument(documentId) {
    try {
      setError("");

      await deleteDocument(documentId);

      if (selectedDocumentId === documentId) {
        setSelectedDocumentId("");
      }

      await loadDocuments();
    } catch (err) {
      console.error(err);
      setError("Failed to delete document.");
    }
  }

  const selectedDocument = documents.find(
    (doc) => doc.id === selectedDocumentId
  );

  const value = {
    documents,
    selectedDocumentId,
    selectedDocument,
    uploading,
    loadingDocs,
    error,
    setError,
    handleSelectDocument,
    handleUpload,
    handleDeleteDocument,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
