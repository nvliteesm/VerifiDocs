from typing import List, Optional
from pydantic import BaseModel


class EvaluationTestCaseCreate(BaseModel):
    document_id: str
    question: str
    expected_behavior: str
    expected_keywords: List[str] = []
    expected_pages: List[int] = []


class EvaluationTestCase(BaseModel):
    id: str
    document_id: str
    question: str
    expected_behavior: str
    expected_keywords: List[str] = []
    expected_pages: List[int] = []
    created_at: Optional[str] = None


class EvaluationRunRequest(BaseModel):
    document_id: str


class EvaluationResult(BaseModel):
    id: str
    test_case_id: str
    document_id: str
    question: str
    expected_behavior: str
    actual_behavior: str
    passed: bool
    retrieval_hit: bool
    keyword_hit: bool
    confidence: Optional[str] = None
    confidence_reason: Optional[str] = None
    answer: Optional[str] = None
    sources: list[dict] = []
    created_at: Optional[str] = None


class EvaluationRunResponse(BaseModel):
    results: List[EvaluationResult]