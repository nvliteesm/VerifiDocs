import json

from fastapi import HTTPException
from google import genai
from google.genai import errors

from app.core.config import settings
from app.models.accuracy_test import EvaluationResult


_client = None


def get_gemini_client():
    global _client

    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)

    return _client

INSUFFICIENT_INFORMATION_RESPONSE = (
    "The document does not provide enough information to answer this question."
)

EVALUATOR_PROMPT_TEMPLATE = """You are an accuracy evaluator for a RAG document Q&A system.
Compare the AI-generated answer against the source evidence and reference answer.
Judge ONLY based on the source evidence — do not use general knowledge.

Output a JSON object with these exact fields:
- judgment: one of "supported_by_source", "partially_supported", "unsupported",
  "missing_information", "possible_hallucination", "insufficient_evidence"
- status: one of "likely_correct", "needs_review", "incorrect"
- confidence_score: number between 0 and 1
- reason: 1-2 sentence explanation
- failure_reason: one of "wrong_answer", "incomplete_answer", "hallucinated_answer",
  "wrong_source_retrieved", "no_source_found", "question_unclear", or null

Rules for status assignment:
- If confidence_score < 0.6, status MUST be "needs_review"
- If judgment is "unsupported" or "possible_hallucination", status MUST be "incorrect"
- If judgment is "supported_by_source" and confidence_score >= 0.6, status MUST be "likely_correct"
- Otherwise, status MUST be "needs_review"

Question: {question}
AI Answer: {ai_answer}
Reference Answer: {reference_answer}
Source Evidence: {formatted_evidence}

JSON Output:"""


REFERENCE_ANSWER_PROMPT_TEMPLATE = """You are a document-grounded answer generator.
Given a question and source evidence chunks from a document, write a concise
reference answer (1-3 sentences) using ONLY the information in the provided chunks.

If the chunks do not contain enough information to answer the question,
respond exactly with: "The document does not provide enough information to answer this question."

Do NOT use any general knowledge or external information.

Source Evidence:
{formatted_chunks}

Question: {question}

Reference Answer:"""


def build_reference_answer_prompt(question: str, source_evidence: list[dict]) -> str:
    """
    Build the reference answer generation prompt from question and source evidence.

    Formats source evidence chunks into the prompt template with explicit
    instructions to use only provided evidence.
    """
    chunk_blocks = []
    for index, chunk in enumerate(source_evidence, start=1):
        content = chunk.get("content", "")
        page_number = chunk.get("page_number", "N/A")
        chunk_blocks.append(
            f"Chunk {index} (Page {page_number}):\n{content}"
        )

    formatted_chunks = "\n\n".join(chunk_blocks) if chunk_blocks else "No source evidence provided."

    return REFERENCE_ANSWER_PROMPT_TEMPLATE.format(
        formatted_chunks=formatted_chunks,
        question=question,
    )


def generate_reference_answer(question: str, source_evidence: list[dict]) -> str:
    """
    Generate a concise reference answer from source chunks only.

    Uses Gemini to produce a grounded reference answer based solely on the
    provided source evidence chunks. Returns a fallback string if source
    evidence is empty.

    Raises:
        HTTPException: With 503 status if Gemini API is unavailable.
    """
    if not source_evidence:
        return INSUFFICIENT_INFORMATION_RESPONSE

    prompt = build_reference_answer_prompt(question, source_evidence)

    try:
        response = get_gemini_client().models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=prompt,
        )
        return response.text

    except errors.ServerError:
        raise HTTPException(
            status_code=503,
            detail="Reference answer generation failed. Please try again later.",
        )

    except errors.APIError as error:
        raise HTTPException(
            status_code=503,
            detail="Reference answer generation failed. Please try again later.",
        )


def determine_status(judgment: str, confidence_score: float) -> str:
    """
    Determine the evaluation status based on business rules.

    Rules applied in order:
    1. If confidence_score < 0.6, status is "needs_review"
    2. If judgment is "unsupported" or "possible_hallucination", status is "incorrect"
    3. If judgment is "supported_by_source" and confidence_score >= 0.6, status is "likely_correct"
    4. Otherwise, status is "needs_review"
    """
    if confidence_score < 0.6:
        return "needs_review"
    if judgment in ("unsupported", "possible_hallucination"):
        return "incorrect"
    if judgment == "supported_by_source" and confidence_score >= 0.6:
        return "likely_correct"
    return "needs_review"


def build_evaluator_prompt(
    question: str,
    ai_answer: str,
    source_evidence: list[dict],
    reference_answer: str,
) -> str:
    """
    Build the evaluator prompt from question, AI answer, source evidence, and reference answer.

    Formats source evidence chunks and inserts all four inputs into the evaluator
    prompt template with explicit instructions for source-only judgment.
    """
    chunk_blocks = []
    for index, chunk in enumerate(source_evidence, start=1):
        content = chunk.get("content", "")
        page_number = chunk.get("page_number", "N/A")
        chunk_blocks.append(
            f"Chunk {index} (Page {page_number}):\n{content}"
        )

    formatted_evidence = "\n\n".join(chunk_blocks) if chunk_blocks else "No source evidence provided."

    return EVALUATOR_PROMPT_TEMPLATE.format(
        question=question,
        ai_answer=ai_answer,
        reference_answer=reference_answer,
        formatted_evidence=formatted_evidence,
    )


def evaluate_accuracy(
    question: str,
    ai_answer: str,
    source_evidence: list[dict],
    reference_answer: str,
) -> EvaluationResult:
    """
    Run the AI evaluator on an accuracy test case and return structured judgment.

    Calls Gemini with JSON mode to produce a structured evaluation comparing the
    AI answer against the source evidence and reference answer. Enforces business
    rules for status assignment on the parsed result.

    Raises:
        HTTPException: With 503 status if Gemini API is unavailable.
        ValueError: If Gemini returns malformed JSON that cannot be parsed.
    """
    prompt = build_evaluator_prompt(question, ai_answer, source_evidence, reference_answer)

    try:
        response = get_gemini_client().models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )
    except errors.ServerError:
        raise HTTPException(
            status_code=503,
            detail="AI evaluator is currently unavailable. Please try again later.",
        )
    except errors.APIError:
        raise HTTPException(
            status_code=503,
            detail="AI evaluator is currently unavailable. Please try again later.",
        )

    try:
        result_data = json.loads(response.text)
    except (json.JSONDecodeError, TypeError) as exc:
        raise ValueError(
            f"Evaluator returned malformed JSON response: {exc}"
        )

    # Enforce business rules for status assignment
    judgment = result_data.get("judgment", "")
    confidence_score = result_data.get("confidence_score", 0.0)
    result_data["status"] = determine_status(judgment, confidence_score)

    try:
        return EvaluationResult(**result_data)
    except Exception as exc:
        raise ValueError(
            f"Evaluator response does not match expected schema: {exc}"
        )
