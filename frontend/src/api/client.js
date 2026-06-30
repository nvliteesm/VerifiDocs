import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL;
const API_KEY = import.meta.env.VITE_API_KEY;

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    "X-API-Key": API_KEY,
  },
});

export async function uploadDocument(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await api.post("/documents/upload", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  return response.data;
}

export async function getDocuments() {
  const response = await api.get("/documents");
  return response.data;
}

export async function deleteDocument(documentId) {
  const response = await api.delete(`/documents/${documentId}`);
  return response.data;
}

export async function askQuestion({ question, documentId }) {
  const response = await api.post("/chat", {
    question,
    document_id: documentId || null,
  });

  return response.data;
}

export async function getChatHistory(documentId) {
  const params = documentId ? `?document_id=${documentId}` : "";

  const response = await api.get(`/chat/history${params}`);

  return response.data;
}

export async function clearChatHistory(documentId) {
  const params = documentId ? `?document_id=${documentId}` : "";

  const response = await api.delete(`/chat/history${params}`);

  return response.data;
}

export async function createAccuracyTest(payload) {
  const response = await api.post("/accuracy-tests", payload);
  return response.data;
}

export async function getAccuracyTests(documentId) {
  const params = documentId ? `?document_id=${documentId}` : "";
  const response = await api.get(`/accuracy-tests${params}`);
  return response.data;
}

export async function reEvaluateAccuracyTest(testId) {
  const response = await api.post(`/accuracy-tests/${testId}/evaluate`);
  return response.data;
}

export async function reviewAccuracyTest(testId, payload) {
  const response = await api.patch(`/accuracy-tests/${testId}/review`, payload);
  return response.data;
}

export async function getAccuracyTestSummary() {
  const response = await api.get("/accuracy-tests/summary");
  return response.data;
}