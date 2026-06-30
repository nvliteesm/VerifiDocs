from typing import Optional, Literal

from pydantic import BaseModel, Field


class AccuracyTestCreateRequest(BaseModel):
    document_id: Optional[str] = None
    question: str
    ai_answer: str
    source_evidence: list[dict]


class AccuracyTestReviewRequest(BaseModel):
    human_status: Literal["human_approved", "human_rejected"]
    human_notes: Optional[str] = None


class EvaluationResult(BaseModel):
    judgment: Literal[
        "supported_by_source",
        "partially_supported",
        "unsupported",
        "missing_information",
        "possible_hallucination",
        "insufficient_evidence",
    ]
    status: Literal["likely_correct", "needs_review", "incorrect"]
    confidence_score: float = Field(ge=0.0, le=1.0)
    reason: str
    failure_reason: Optional[Literal[
        "wrong_answer",
        "incomplete_answer",
        "hallucinated_answer",
        "wrong_source_retrieved",
        "no_source_found",
        "question_unclear",
    ]] = None


class AccuracyTestSummary(BaseModel):
    total_tests: int
    likely_correct_count: int
    needs_review_count: int
    incorrect_count: int
    human_approved_count: int
    human_rejected_count: int
    average_confidence: float
