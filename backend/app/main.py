from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.api.dependencies import verify_api_key
from app.api.routes import documents, chat, accuracy_tests
from app.core.config import settings

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="VerifiDocs API",
    description="A RAG-based document assistant for grounded PDF question answering.",
    version="0.1.0",
    dependencies=[Depends(verify_api_key)],
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents.router, prefix="/documents", tags=["Documents"])
app.include_router(chat.router, prefix="/chat", tags=["Chat"])
app.include_router(accuracy_tests.router, prefix="/accuracy-tests", tags=["Accuracy Tests"])


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
