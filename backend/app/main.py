from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.dependencies import verify_api_key
from app.api.routes import documents, chat, evaluation
from app.core.config import settings

app = FastAPI(
    title="VerifiDocs API",
    description="A RAG-based document assistant for grounded PDF question answering.",
    version="0.1.0",
    dependencies=[Depends(verify_api_key)],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents.router, prefix="/documents", tags=["Documents"])
app.include_router(chat.router, prefix="/chat", tags=["Chat"])
app.include_router(evaluation.router, prefix="/evaluation", tags=["Evaluation"])


@app.get("/")
def root():
    return {
        "message": "VerifiDocs backend is running",
        "version": "0.1.0",
    }


@app.get("/health")
def health_check():
    return {
        "status": "ok",
    }
