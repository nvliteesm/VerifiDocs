import UploadBox from "./uploadBox";
import DocumentList from "./documentList";

function Sidebar({
  documents,
  selectedDocumentId,
  uploading,
  loadingDocs,
  onUpload,
  onSelectDocument,
  onDeleteDocument,
}) {
  return (
    <aside className="hidden w-80 border-r border-slate-200 bg-white p-5 md:block">
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight">AskDocs AI</h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload PDFs and ask grounded questions.
        </p>
      </div>

      <UploadBox uploading={uploading} onUpload={onUpload} />

      <DocumentList
        documents={documents}
        selectedDocumentId={selectedDocumentId}
        loadingDocs={loadingDocs}
        onSelectDocument={onSelectDocument}
        onDeleteDocument={onDeleteDocument}
      />
    </aside>
  );
}

export default Sidebar;