from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.db.supabase import supabase
from app.models.chat import ChatRequest, ChatResponse, ChatHistoryResponse
from app.rag.generator import generate_answer
from app.rag.prompts import build_grounded_prompt
from app.rag.response_utils import calculate_confidence, format_sources, build_preview
from app.rag.retriever import retrieve_relevant_chunks

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


@router.post("/", response_model=ChatResponse)
@limiter.limit("10/minute")
def ask_question(request: Request, body: ChatRequest):
    return process_question(body)


def process_question(body: ChatRequest):
    """Core Q&A logic, callable from both the route and evaluation."""
    question = body.question.strip()

    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    document_metadata = None

    if body.document_id:
        validate_document_id(body.document_id)

        document_response = (
            supabase
            .table("documents")
            .select("id, filename, total_pages, created_at")
            .eq("id", body.document_id)
            .limit(1)
            .execute()
        )

        if not document_response.data:
            raise HTTPException(status_code=404, detail="Document not found.")

        document_metadata = document_response.data[0]

    lower_question = question.lower()

    if document_metadata and any(
        phrase in lower_question
        for phrase in [
            "how many pages",
            "number of pages",
            "total pages",
            "page count",
        ]
    ):
        response_data = {
            "answer": f"This document has {document_metadata['total_pages']} pages.",
            "confidence": "high",
            "confidence_reason": "The answer comes directly from the stored document metadata.",
            "sources": [],
        }

        save_chat_message(
            document_id=body.document_id,
            question=question,
            response_data=response_data,
        )

        return response_data

    chunks = retrieve_relevant_chunks(
        question=question,
        document_id=body.document_id,
        match_count=5,
    )

    confidence, confidence_reason = calculate_confidence(chunks)

    if not chunks:
        response_data = {
            "answer": "I could not find this information in the uploaded document.",
            "confidence": confidence,
            "confidence_reason": confidence_reason,
            "sources": [],
        }

        save_chat_message(
            document_id=body.document_id,
            question=question,
            response_data=response_data,
        )

        return response_data

    formatted_sources = format_sources(chunks)

    if confidence == "not_found":
        response_data = {
            "answer": "I could not find this information in the uploaded document.",
            "confidence": confidence,
            "confidence_reason": confidence_reason,
            "sources": formatted_sources,
        }

        save_chat_message(
            document_id=body.document_id,
            question=question,
            response_data=response_data,
        )

        return response_data

    prompt = build_grounded_prompt(
        question=question,
        chunks=chunks,
    )

    answer = generate_answer(prompt)

    response_data = {
        "answer": answer,
        "confidence": confidence,
        "confidence_reason": confidence_reason,
        "sources": formatted_sources,
    }

    save_chat_message(
        document_id=body.document_id,
        question=question,
        response_data=response_data,
    )

    return response_data


@router.get("/history", response_model=ChatHistoryResponse)
def get_chat_history(document_id: str | None = Query(default=None)):
    if document_id:
        validate_document_id(document_id)

        response = (
            supabase
            .table("chat_messages")
            .select("*")
            .eq("document_id", document_id)
            .order("created_at", desc=True)
            .limit(30)
            .execute()
        )
    else:
        response = (
            supabase
            .table("chat_messages")
            .select("*")
            .is_("document_id", "null")
            .order("created_at", desc=True)
            .limit(30)
            .execute()
        )

    return {
        "messages": response.data or []
    }


@router.delete("/history")
def clear_chat_history(document_id: str | None = Query(default=None)):
    if document_id:
        validate_document_id(document_id)

        (
            supabase
            .table("chat_messages")
            .delete()
            .eq("document_id", document_id)
            .execute()
        )
    else:
        (
            supabase
            .table("chat_messages")
            .delete()
            .is_("document_id", "null")
            .execute()
        )

    return {
        "message": "Chat history cleared."
    }


def validate_document_id(document_id: str):
    try:
        UUID(document_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid document ID format.")


def save_chat_message(document_id: str | None, question: str, response_data: dict):
    """
    Save a completed Q&A pair.

    History saving should not block the main answer flow.
    If saving fails, the user should still receive the generated answer.
    """
    try:
        supabase.table("chat_messages").insert(
            {
                "document_id": document_id,
                "question": question,
                "answer": response_data["answer"],
                "confidence": response_data["confidence"],
                "confidence_reason": response_data["confidence_reason"],
                "sources": response_data["sources"],
            }
        ).execute()
    except Exception as error:
        print(f"Failed to save chat message: {error}")


