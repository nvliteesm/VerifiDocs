from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.db.supabase import supabase
from app.models.evaluation import (
    EvaluationRunRequest,
    EvaluationRunResponse,
    EvaluationTestCaseCreate,
)
from app.rag.generator import generate_answer
from app.rag.prompts import build_grounded_prompt
from app.rag.response_utils import calculate_confidence, format_sources
from app.rag.retriever import retrieve_relevant_chunks

router = APIRouter()


@router.post("/test-cases")
def create_test_case(payload: EvaluationTestCaseCreate):
    validate_uuid(payload.document_id, "Invalid document ID format.")

    if not payload.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    if payload.expected_behavior not in ["answer", "refuse"]:
        raise HTTPException(
            status_code=400,
            detail="Expected behavior must be either 'answer' or 'refuse'.",
        )

    document = get_document(payload.document_id)

    if not document:
        raise HTTPException(status_code=404, detail="Document not found.")

    response = (
        supabase
        .table("evaluation_test_cases")
        .insert({
            "document_id": payload.document_id,
            "question": payload.question.strip(),
            "expected_behavior": payload.expected_behavior,
            "expected_keywords": payload.expected_keywords,
            "expected_pages": payload.expected_pages,
        })
        .execute()
    )

    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to create evaluation test case.")

    return response.data[0]


@router.get("/test-cases")
def list_test_cases(document_id: str):
    validate_uuid(document_id, "Invalid document ID format.")

    response = (
        supabase
        .table("evaluation_test_cases")
        .select("*")
        .eq("document_id", document_id)
        .order("created_at", desc=True)
        .execute()
    )

    return response.data or []


@router.delete("/test-cases/{test_case_id}")
def delete_test_case(test_case_id: str):
    validate_uuid(test_case_id, "Invalid test case ID format.")

    response = (
        supabase
        .table("evaluation_test_cases")
        .delete()
        .eq("id", test_case_id)
        .execute()
    )

    if not response.data:
        raise HTTPException(status_code=404, detail="Evaluation test case not found.")

    return {"message": "Evaluation test case deleted successfully."}


@router.post("/run", response_model=EvaluationRunResponse)
def run_evaluation(payload: EvaluationRunRequest):
    validate_uuid(payload.document_id, "Invalid document ID format.")

    document = get_document(payload.document_id)

    if not document:
        raise HTTPException(status_code=404, detail="Document not found.")

    test_cases_response = (
        supabase
        .table("evaluation_test_cases")
        .select("*")
        .eq("document_id", payload.document_id)
        .order("created_at", desc=False)
        .execute()
    )

    test_cases = test_cases_response.data or []

    if not test_cases:
        return {"results": []}

    results = []

    for test_case in test_cases:
        result = run_single_test_case(test_case)
        saved_result = save_evaluation_result(result)
        results.append(saved_result)

    return {"results": results}


@router.get("/runs")
def list_runs(document_id: str):
    validate_uuid(document_id, "Invalid document ID format.")

    response = (
        supabase
        .table("evaluation_runs")
        .select("*")
        .eq("document_id", document_id)
        .order("created_at", desc=True)
        .execute()
    )

    return response.data or []


def run_single_test_case(test_case: dict) -> dict:
    question = test_case["question"]
    document_id = test_case["document_id"]
    expected_behavior = test_case["expected_behavior"]
    expected_keywords = test_case.get("expected_keywords") or []
    expected_pages = test_case.get("expected_pages") or []

    chunks = retrieve_relevant_chunks(
        question=question,
        document_id=document_id,
        match_count=5,
    )

    confidence, confidence_reason = calculate_confidence(chunks)
    sources = format_sources(chunks)

    if not chunks or confidence == "not_found":
        answer = "I could not find this information in the uploaded document."
        actual_behavior = "refuse"
    else:
        prompt = build_grounded_prompt(
            question=question,
            chunks=chunks,
        )
        answer = generate_answer(prompt)
        actual_behavior = detect_actual_behavior(answer)

    retrieval_hit = check_retrieval_hit(
        sources=sources,
        expected_pages=expected_pages,
    )

    keyword_hit = check_keyword_hit(
        answer=answer,
        expected_keywords=expected_keywords,
        expected_behavior=expected_behavior,
    )

    passed = calculate_passed(
        expected_behavior=expected_behavior,
        actual_behavior=actual_behavior,
        retrieval_hit=retrieval_hit,
        keyword_hit=keyword_hit,
        expected_pages=expected_pages,
        expected_keywords=expected_keywords,
    )

    return {
        "document_id": document_id,
        "test_case_id": test_case["id"],
        "question": question,
        "expected_behavior": expected_behavior,
        "actual_behavior": actual_behavior,
        "passed": passed,
        "retrieval_hit": retrieval_hit,
        "keyword_hit": keyword_hit,
        "confidence": confidence,
        "confidence_reason": confidence_reason,
        "answer": answer,
        "sources": sources,
    }


def save_evaluation_result(result: dict) -> dict:
    response = (
        supabase
        .table("evaluation_runs")
        .insert(result)
        .execute()
    )

    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to save evaluation result.")

    return response.data[0]


def check_retrieval_hit(sources: list[dict], expected_pages: list[int]) -> bool:
    if not expected_pages:
        return True

    source_pages = {
        source.get("page_number")
        for source in sources
        if source.get("page_number") is not None
    }

    return any(page in source_pages for page in expected_pages)


def check_keyword_hit(
    answer: str,
    expected_keywords: list[str],
    expected_behavior: str,
) -> bool:
    if expected_behavior == "refuse":
        return True

    if not expected_keywords:
        return True

    normalized_answer = answer.lower()

    return any(
        keyword.lower() in normalized_answer
        for keyword in expected_keywords
    )


def calculate_passed(
    expected_behavior: str,
    actual_behavior: str,
    retrieval_hit: bool,
    keyword_hit: bool,
    expected_pages: list[int],
    expected_keywords: list[str],
) -> bool:
    if expected_behavior == "refuse":
        return actual_behavior == "refuse"

    if actual_behavior != "answer":
        return False

    if expected_pages and not retrieval_hit:
        return False

    if expected_keywords and not keyword_hit:
        return False

    return True


def detect_actual_behavior(answer: str) -> str:
    normalized_answer = answer.strip().lower()

    refusal_phrases = [
        "i could not find this information in the uploaded document",
        "not found in the uploaded document",
        "the document does not contain",
        "the context does not provide",
    ]

    if any(phrase in normalized_answer for phrase in refusal_phrases):
        return "refuse"

    return "answer"


def get_document(document_id: str):
    response = (
        supabase
        .table("documents")
        .select("id")
        .eq("id", document_id)
        .limit(1)
        .execute()
    )

    return response.data[0] if response.data else None


def validate_uuid(value: str, error_message: str):
    try:
        UUID(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=error_message)