import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL;

export const api = axios.create({
  baseURL: API_URL,
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