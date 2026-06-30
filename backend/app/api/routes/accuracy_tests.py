from typing import Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query

from app.db.supabase import supabase
from app.models.accuracy_test import (
    AccuracyTestCreateRequest,
    AccuracyTestReviewRequest,
    AccuracyTestSummary,
)
from app.rag.accuracy_evaluator import generate_reference_answer, evaluate_accuracy


router = APIRouter()


def validate_uuid(value: str, field_name: str):
    try:
        UUID(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name} format.")


@router.post("", status_code=201)
def create_accuracy_test(request: AccuracyTestCreateRequest):
    """Create an accuracy test with auto-generated reference answer and evaluation."""
    question = request.question.strip()
    ai_answer = request.ai_answer.strip()

    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    if not ai_answer:
        raise HTTPException(status_code=400, detail="AI answer cannot be empty.")

    if request.document_id:
        validate_uuid(request.document_id, "document_id")

    # Handle empty source_evidence: skip LLM calls
    if not request.source_evidence:
        payload = {
            "document_id": request.document_id,
            "question": question,
            "ai_answer": ai_answer,
            "source_evidence": request.source_evidence,
            "reference_answer": None,
            "judgment": "insufficient_evidence",
            "status": "needs_review",
            "confidence_score": None,
            "reason": "No source evidence provided for evaluation.",
            "failure_reason": None,
        }

        try:
            response = (
                supabase
                .table("accuracy_tests")
                .insert(payload)
                .execute()
            )
            return response.data[0]
        except Exception:
            raise HTTPException(
                status_code=500,
                detail="Failed to save accuracy test.",
            )

    # Generate reference answer (may raise HTTPException 503)
    reference_answer = generate_reference_answer(question, request.source_evidence)

    # Evaluate accuracy (may raise HTTPException 503 or ValueError)
    try:
        evaluation_result = evaluate_accuracy(
            question=question,
            ai_answer=ai_answer,
            source_evidence=request.source_evidence,
            reference_answer=reference_answer,
        )
    except ValueError:
        # Malformed evaluator response: save with needs_review status
        payload = {
            "document_id": request.document_id,
            "question": question,
            "ai_answer": ai_answer,
            "source_evidence": request.source_evidence,
            "reference_answer": reference_answer,
            "judgment": None,
            "status": "needs_review",
            "confidence_score": None,
            "reason": "Evaluator response could not be parsed",
            "failure_reason": None,
        }

        try:
            response = (
                supabase
                .table("accuracy_tests")
                .insert(payload)
                .execute()
            )
            return response.data[0]
        except Exception:
            raise HTTPException(
                status_code=500,
                detail="Failed to save accuracy test.",
            )

    # Build payload with evaluation results
    payload = {
        "document_id": request.document_id,
        "question": question,
        "ai_answer": ai_answer,
        "source_evidence": request.source_evidence,
        "reference_answer": reference_answer,
        "judgment": evaluation_result.judgment,
        "status": evaluation_result.status,
        "confidence_score": evaluation_result.confidence_score,
        "reason": evaluation_result.reason,
        "failure_reason": evaluation_result.failure_reason,
    }

    try:
        response = (
            supabase
            .table("accuracy_tests")
            .insert(payload)
            .execute()
        )
        return response.data[0]
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Failed to save accuracy test.",
        )


@router.get("")
def list_accuracy_tests(document_id: Optional[str] = Query(None)):
    """List accuracy tests ordered by created_at descending, with optional document_id filter."""
    if document_id:
        validate_uuid(document_id, "document_id")

    try:
        query = supabase.table("accuracy_tests").select("*")

        if document_id:
            query = query.eq("document_id", document_id)

        query = query.order("created_at", desc=True)
        response = query.execute()
        return response.data
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve accuracy tests.",
        )


@router.get("/summary")
def get_accuracy_tests_summary():
    """Return summary metrics for all accuracy tests."""
    try:
        response = (
            supabase
            .table("accuracy_tests")
            .select("*")
            .execute()
        )
        records = response.data
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve accuracy tests summary.",
        )

    total_tests = len(records)

    likely_correct_count = sum(1 for r in records if r.get("status") == "likely_correct")
    needs_review_count = sum(1 for r in records if r.get("status") == "needs_review")
    incorrect_count = sum(1 for r in records if r.get("status") == "incorrect")
    human_approved_count = sum(1 for r in records if r.get("status") == "human_approved")
    human_rejected_count = sum(1 for r in records if r.get("status") == "human_rejected")

    confidence_scores = [
        r["confidence_score"]
        for r in records
        if r.get("confidence_score") is not None
    ]
    average_confidence = (
        sum(confidence_scores) / len(confidence_scores)
        if confidence_scores
        else 0.0
    )

    return AccuracyTestSummary(
        total_tests=total_tests,
        likely_correct_count=likely_correct_count,
        needs_review_count=needs_review_count,
        incorrect_count=incorrect_count,
        human_approved_count=human_approved_count,
        human_rejected_count=human_rejected_count,
        average_confidence=round(average_confidence, 2),
    )


@router.post("/{test_id}/evaluate")
def re_evaluate_accuracy_test(test_id: str):
    """Re-run the full evaluation pipeline on an existing accuracy test."""
    # Validate UUID format
    try:
        UUID(test_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Accuracy test not found.")

    # Fetch existing test record
    response = (
        supabase
        .table("accuracy_tests")
        .select("*")
        .eq("id", test_id)
        .execute()
    )

    if not response.data:
        raise HTTPException(status_code=404, detail="Accuracy test not found.")

    test_record = response.data[0]

    question = test_record["question"]
    ai_answer = test_record["ai_answer"]
    source_evidence = test_record["source_evidence"]

    # Handle empty source_evidence: skip LLM calls
    if not source_evidence:
        update_payload = {
            "reference_answer": None,
            "judgment": "insufficient_evidence",
            "status": "needs_review",
            "confidence_score": None,
            "reason": "No source evidence provided for evaluation.",
            "failure_reason": None,
        }

        try:
            updated = (
                supabase
                .table("accuracy_tests")
                .update(update_payload)
                .eq("id", test_id)
                .execute()
            )
            return updated.data[0]
        except Exception:
            raise HTTPException(
                status_code=500,
                detail="Failed to update accuracy test.",
            )

    # Re-generate reference answer (may raise HTTPException 503)
    reference_answer = generate_reference_answer(question, source_evidence)

    # Re-evaluate accuracy (may raise HTTPException 503 or ValueError)
    try:
        evaluation_result = evaluate_accuracy(
            question=question,
            ai_answer=ai_answer,
            source_evidence=source_evidence,
            reference_answer=reference_answer,
        )
    except ValueError:
        # Malformed evaluator response: update with needs_review status
        update_payload = {
            "reference_answer": reference_answer,
            "judgment": None,
            "status": "needs_review",
            "confidence_score": None,
            "reason": "Evaluator response could not be parsed",
            "failure_reason": None,
        }

        try:
            updated = (
                supabase
                .table("accuracy_tests")
                .update(update_payload)
                .eq("id", test_id)
                .execute()
            )
            return updated.data[0]
        except Exception:
            raise HTTPException(
                status_code=500,
                detail="Failed to update accuracy test.",
            )

    # Update record with new evaluation results
    update_payload = {
        "reference_answer": reference_answer,
        "judgment": evaluation_result.judgment,
        "status": evaluation_result.status,
        "confidence_score": evaluation_result.confidence_score,
        "reason": evaluation_result.reason,
        "failure_reason": evaluation_result.failure_reason,
    }

    try:
        updated = (
            supabase
            .table("accuracy_tests")
            .update(update_payload)
            .eq("id", test_id)
            .execute()
        )
        return updated.data[0]
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Failed to update accuracy test.",
        )


@router.patch("/{test_id}/review")
def review_accuracy_test(test_id: str, request: AccuracyTestReviewRequest):
    """Apply a human review (approve/reject) to an existing accuracy test."""
    # Validate UUID format
    try:
        UUID(test_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Accuracy test not found.")

    # Validate human_status value
    if request.human_status not in ("human_approved", "human_rejected"):
        raise HTTPException(
            status_code=400,
            detail="Invalid human_status. Must be 'human_approved' or 'human_rejected'.",
        )

    # Fetch existing test record
    response = (
        supabase
        .table("accuracy_tests")
        .select("*")
        .eq("id", test_id)
        .execute()
    )

    if not response.data:
        raise HTTPException(status_code=404, detail="Accuracy test not found.")

    # Update human review fields
    update_payload = {
        "human_status": request.human_status,
        "human_notes": request.human_notes,
    }

    try:
        updated = (
            supabase
            .table("accuracy_tests")
            .update(update_payload)
            .eq("id", test_id)
            .execute()
        )
        return updated.data[0]
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Failed to update accuracy test.",
        )
