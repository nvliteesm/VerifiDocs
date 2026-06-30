# Feature: ai-accuracy-testing, Property 2: Reference answer prompt grounding
# Feature: ai-accuracy-testing, Property 3: Evaluator prompt completeness
# Feature: ai-accuracy-testing, Property 4: Evaluator output validation
# Feature: ai-accuracy-testing, Property 5: Status assignment business rules
"""
Property-based tests for the AI accuracy evaluator module.

Property 2: Reference answer prompt grounding
- For any question string and any list of source evidence chunks, the constructed
  reference answer prompt SHALL contain only the question and the content from the
  source evidence chunks, with explicit instructions forbidding external knowledge.

Validates: Requirements 2.1, 2.4

Property 3: Evaluator prompt completeness
- For any (question, ai_answer, source_evidence, reference_answer) tuple, the
  constructed evaluator prompt SHALL contain all four input components and
  instructions to judge only against source evidence.

Validates: Requirements 3.1, 3.3

Property 5: Status assignment business rules
- For any evaluator output, the status field SHALL be determined by the following
  rules applied in order: (1) if confidence_score < 0.6 then status is "needs_review",
  (2) if judgment is "unsupported" or "possible_hallucination" then status is "incorrect",
  (3) if judgment is "supported_by_source" and confidence_score >= 0.6 then status is
  "likely_correct", (4) otherwise status is "needs_review".

Validates: Requirements 3.4, 3.5, 3.6
"""

from hypothesis import given, settings, assume
from hypothesis import strategies as st

from app.rag.accuracy_evaluator import build_reference_answer_prompt, build_evaluator_prompt, determine_status
from app.models.accuracy_test import EvaluationResult


# --- Strategies ---

# Generate non-empty question strings (printable text, no empty strings)
question_strategy = st.text(min_size=1, max_size=200).filter(lambda s: s.strip() != "")

# Generate source evidence chunks: list of dicts with "content" and "page_number"
chunk_strategy = st.fixed_dictionaries({
    "content": st.text(min_size=1, max_size=500).filter(lambda s: s.strip() != ""),
    "page_number": st.one_of(st.integers(min_value=1, max_value=1000), st.just("N/A")),
})

source_evidence_strategy = st.lists(chunk_strategy, min_size=1, max_size=10)


# --- Property Tests ---

class TestReferenceAnswerPromptGrounding:
    """Property 2: Reference answer prompt grounding."""

    @given(question=question_strategy, source_evidence=source_evidence_strategy)
    @settings(max_examples=100)
    def test_prompt_contains_question(self, question: str, source_evidence: list[dict]):
        """The constructed prompt must contain the question."""
        # **Validates: Requirements 2.1, 2.4**
        prompt = build_reference_answer_prompt(question, source_evidence)
        assert question in prompt, (
            f"Question not found in prompt. Question: {question!r}"
        )

    @given(question=question_strategy, source_evidence=source_evidence_strategy)
    @settings(max_examples=100)
    def test_prompt_contains_all_chunk_contents(self, question: str, source_evidence: list[dict]):
        """The constructed prompt must contain each chunk's content value."""
        # **Validates: Requirements 2.1, 2.4**
        prompt = build_reference_answer_prompt(question, source_evidence)
        for i, chunk in enumerate(source_evidence):
            content = chunk["content"]
            assert content in prompt, (
                f"Chunk {i} content not found in prompt. Content: {content!r}"
            )

    @given(question=question_strategy, source_evidence=source_evidence_strategy)
    @settings(max_examples=100)
    def test_prompt_forbids_external_knowledge(self, question: str, source_evidence: list[dict]):
        """The prompt must contain instructions forbidding external knowledge."""
        # **Validates: Requirements 2.1, 2.4**
        prompt = build_reference_answer_prompt(question, source_evidence)
        assert "Do NOT use any general knowledge" in prompt, (
            "Prompt missing instruction to forbid external knowledge"
        )

    @given(question=question_strategy, source_evidence=source_evidence_strategy)
    @settings(max_examples=100)
    def test_prompt_contains_only_provided_content(self, question: str, source_evidence: list[dict]):
        """
        The prompt must not contain content beyond what's provided in the
        source evidence, the question, and the fixed template instructions.

        We verify this by checking that every non-template line in the prompt
        can be traced back to the question or to one of the source chunks.
        """
        # **Validates: Requirements 2.1, 2.4**
        prompt = build_reference_answer_prompt(question, source_evidence)

        # The fixed template portions that are expected
        expected_template_fragments = [
            "You are a document-grounded answer generator.",
            "Given a question and source evidence chunks from a document, write a concise",
            "reference answer (1-3 sentences) using ONLY the information in the provided chunks.",
            'If the chunks do not contain enough information to answer the question,',
            'respond exactly with: "The document does not provide enough information to answer this question."',
            "Do NOT use any general knowledge or external information.",
            "Source Evidence:",
            "Question:",
            "Reference Answer:",
        ]

        # Build set of all content that should be in the prompt
        allowed_contents = set()
        allowed_contents.add(question)
        for fragment in expected_template_fragments:
            allowed_contents.add(fragment)
        for i, chunk in enumerate(source_evidence, start=1):
            allowed_contents.add(chunk["content"])
            page = chunk.get("page_number", "N/A")
            allowed_contents.add(f"Chunk {i} (Page {page}):")

        # Every non-empty line in the prompt should be traceable to allowed content
        for line in prompt.split("\n"):
            stripped = line.strip()
            if not stripped:
                continue
            # Check if line is part of template or derived from inputs
            line_is_valid = any(
                fragment in stripped or stripped in fragment
                for fragment in allowed_contents
            )
            if not line_is_valid:
                # The line might be a chunk content line that spans multiple lines
                # or a composite like "Chunk 1 (Page 3):\ncontent..."
                # Check if the line content is a substring of any chunk content
                line_in_chunk = any(
                    stripped in chunk["content"] or chunk["content"] in stripped
                    for chunk in source_evidence
                )
                assert line_in_chunk or any(
                    stripped in fragment or fragment in stripped
                    for fragment in allowed_contents
                ), (
                    f"Prompt contains unexpected content not from inputs or template: {stripped!r}"
                )

    @given(question=question_strategy)
    @settings(max_examples=100)
    def test_empty_source_evidence_still_valid(self, question: str):
        """With empty source evidence, the prompt still contains question and no-external-knowledge rule."""
        # **Validates: Requirements 2.1, 2.4**
        prompt = build_reference_answer_prompt(question, [])
        assert question in prompt
        assert "Do NOT use any general knowledge" in prompt
        assert "No source evidence provided." in prompt


# --- Strategies for Property 5 ---

# Valid judgment values from the evaluator
judgment_strategy = st.sampled_from([
    "supported_by_source",
    "partially_supported",
    "unsupported",
    "missing_information",
    "possible_hallucination",
    "insufficient_evidence",
])

# Confidence score: float between 0.0 and 1.0
confidence_score_strategy = st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)


# --- Property 5 Tests ---

class TestStatusAssignmentBusinessRules:
    """
    Property 5: Status assignment business rules.

    For any evaluator output, the status field SHALL be determined by the following
    rules applied in order:
    1. If confidence_score < 0.6, status is "needs_review"
    2. If judgment is "unsupported" or "possible_hallucination", status is "incorrect"
    3. If judgment is "supported_by_source" and confidence_score >= 0.6, status is "likely_correct"
    4. Otherwise, status is "needs_review"
    """

    @given(judgment=judgment_strategy, confidence_score=confidence_score_strategy)
    @settings(max_examples=100)
    def test_low_confidence_always_needs_review(self, judgment: str, confidence_score: float):
        """Rule 1: If confidence_score < 0.6, status MUST be 'needs_review' regardless of judgment."""
        # **Validates: Requirements 3.4, 3.5, 3.6**
        assume(confidence_score < 0.6)
        status = determine_status(judgment, confidence_score)
        assert status == "needs_review", (
            f"Expected 'needs_review' for confidence_score={confidence_score} < 0.6, "
            f"but got '{status}' with judgment='{judgment}'"
        )

    @given(judgment=st.sampled_from(["unsupported", "possible_hallucination"]),
           confidence_score=confidence_score_strategy)
    @settings(max_examples=100)
    def test_unsupported_or_hallucination_with_high_confidence_is_incorrect(
        self, judgment: str, confidence_score: float
    ):
        """Rule 2: If judgment is 'unsupported' or 'possible_hallucination' and confidence >= 0.6, status MUST be 'incorrect'."""
        # **Validates: Requirements 3.4, 3.5, 3.6**
        assume(confidence_score >= 0.6)
        status = determine_status(judgment, confidence_score)
        assert status == "incorrect", (
            f"Expected 'incorrect' for judgment='{judgment}' with confidence_score={confidence_score} >= 0.6, "
            f"but got '{status}'"
        )

    @given(confidence_score=confidence_score_strategy)
    @settings(max_examples=100)
    def test_supported_with_high_confidence_is_likely_correct(self, confidence_score: float):
        """Rule 3: If judgment is 'supported_by_source' and confidence >= 0.6, status MUST be 'likely_correct'."""
        # **Validates: Requirements 3.4, 3.5, 3.6**
        assume(confidence_score >= 0.6)
        status = determine_status("supported_by_source", confidence_score)
        assert status == "likely_correct", (
            f"Expected 'likely_correct' for judgment='supported_by_source' with "
            f"confidence_score={confidence_score} >= 0.6, but got '{status}'"
        )

    @given(judgment=st.sampled_from(["partially_supported", "missing_information", "insufficient_evidence"]),
           confidence_score=confidence_score_strategy)
    @settings(max_examples=100)
    def test_other_judgments_with_high_confidence_is_needs_review(
        self, judgment: str, confidence_score: float
    ):
        """Rule 4: For other judgments with confidence >= 0.6, status MUST be 'needs_review'."""
        # **Validates: Requirements 3.4, 3.5, 3.6**
        assume(confidence_score >= 0.6)
        status = determine_status(judgment, confidence_score)
        assert status == "needs_review", (
            f"Expected 'needs_review' for judgment='{judgment}' with "
            f"confidence_score={confidence_score} >= 0.6, but got '{status}'"
        )

    @given(judgment=judgment_strategy, confidence_score=confidence_score_strategy)
    @settings(max_examples=100)
    def test_status_always_valid_enum(self, judgment: str, confidence_score: float):
        """For any input, status must be one of the valid enum values."""
        # **Validates: Requirements 3.4, 3.5, 3.6**
        status = determine_status(judgment, confidence_score)
        valid_statuses = {"likely_correct", "needs_review", "incorrect"}
        assert status in valid_statuses, (
            f"Status '{status}' not in valid set {valid_statuses} "
            f"for judgment='{judgment}', confidence_score={confidence_score}"
        )

    @given(judgment=judgment_strategy, confidence_score=confidence_score_strategy)
    @settings(max_examples=100)
    def test_priority_ordered_rules_match(self, judgment: str, confidence_score: float):
        """The determine_status output must match the priority-ordered business rules exactly."""
        # **Validates: Requirements 3.4, 3.5, 3.6**
        status = determine_status(judgment, confidence_score)

        # Compute expected status using the priority-ordered rules
        if confidence_score < 0.6:
            expected = "needs_review"
        elif judgment in ("unsupported", "possible_hallucination"):
            expected = "incorrect"
        elif judgment == "supported_by_source" and confidence_score >= 0.6:
            expected = "likely_correct"
        else:
            expected = "needs_review"

        assert status == expected, (
            f"Status mismatch: got '{status}', expected '{expected}' "
            f"for judgment='{judgment}', confidence_score={confidence_score}"
        )


# Feature: ai-accuracy-testing, Property 4: Evaluator output validation
# --- Strategies for Property 4 ---

# Valid judgment enum values
evaluator_judgment_strategy = st.sampled_from([
    "supported_by_source",
    "partially_supported",
    "unsupported",
    "missing_information",
    "possible_hallucination",
    "insufficient_evidence",
])

# Valid failure_reason enum values (or None)
failure_reason_strategy = st.one_of(
    st.none(),
    st.sampled_from([
        "wrong_answer",
        "incomplete_answer",
        "hallucinated_answer",
        "wrong_source_retrieved",
        "no_source_found",
        "question_unclear",
    ]),
)

# Confidence score: float between 0.0 and 1.0
evaluator_confidence_strategy = st.floats(
    min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False
)

# Non-empty reason string
reason_strategy = st.text(min_size=1, max_size=300).filter(lambda s: s.strip() != "")


# --- Property 4 Tests ---

class TestEvaluatorOutputValidation:
    """
    Property 4: Evaluator output validation.

    For any valid structured JSON output from the evaluator LLM, the parsing logic
    SHALL produce an EvaluationResult with judgment in the valid enum set, status in
    the valid enum set, confidence_score between 0 and 1 inclusive, a non-empty reason
    string, and failure_reason either null or in the valid enum set.

    **Validates: Requirements 3.2**
    """

    @given(
        judgment=evaluator_judgment_strategy,
        confidence_score=evaluator_confidence_strategy,
        reason=reason_strategy,
        failure_reason=failure_reason_strategy,
    )
    @settings(max_examples=100)
    def test_valid_json_parses_into_evaluation_result(
        self,
        judgment: str,
        confidence_score: float,
        reason: str,
        failure_reason,
    ):
        """Valid evaluator output data can be successfully parsed into an EvaluationResult model."""
        # **Validates: Requirements 3.2**
        status = determine_status(judgment, confidence_score)

        result = EvaluationResult(
            judgment=judgment,
            status=status,
            confidence_score=confidence_score,
            reason=reason,
            failure_reason=failure_reason,
        )

        assert result is not None

    @given(
        judgment=evaluator_judgment_strategy,
        confidence_score=evaluator_confidence_strategy,
        reason=reason_strategy,
        failure_reason=failure_reason_strategy,
    )
    @settings(max_examples=100)
    def test_judgment_in_valid_enum_set(
        self,
        judgment: str,
        confidence_score: float,
        reason: str,
        failure_reason,
    ):
        """Parsed EvaluationResult judgment must be in the valid enum set."""
        # **Validates: Requirements 3.2**
        status = determine_status(judgment, confidence_score)

        result = EvaluationResult(
            judgment=judgment,
            status=status,
            confidence_score=confidence_score,
            reason=reason,
            failure_reason=failure_reason,
        )

        valid_judgments = {
            "supported_by_source",
            "partially_supported",
            "unsupported",
            "missing_information",
            "possible_hallucination",
            "insufficient_evidence",
        }
        assert result.judgment in valid_judgments, (
            f"Judgment '{result.judgment}' not in valid set {valid_judgments}"
        )

    @given(
        judgment=evaluator_judgment_strategy,
        confidence_score=evaluator_confidence_strategy,
        reason=reason_strategy,
        failure_reason=failure_reason_strategy,
    )
    @settings(max_examples=100)
    def test_status_in_valid_enum_set(
        self,
        judgment: str,
        confidence_score: float,
        reason: str,
        failure_reason,
    ):
        """Parsed EvaluationResult status must be in the valid status set."""
        # **Validates: Requirements 3.2**
        status = determine_status(judgment, confidence_score)

        result = EvaluationResult(
            judgment=judgment,
            status=status,
            confidence_score=confidence_score,
            reason=reason,
            failure_reason=failure_reason,
        )

        valid_statuses = {"likely_correct", "needs_review", "incorrect"}
        assert result.status in valid_statuses, (
            f"Status '{result.status}' not in valid set {valid_statuses}"
        )

    @given(
        judgment=evaluator_judgment_strategy,
        confidence_score=evaluator_confidence_strategy,
        reason=reason_strategy,
        failure_reason=failure_reason_strategy,
    )
    @settings(max_examples=100)
    def test_confidence_score_between_0_and_1(
        self,
        judgment: str,
        confidence_score: float,
        reason: str,
        failure_reason,
    ):
        """Parsed EvaluationResult confidence_score must be between 0 and 1 inclusive."""
        # **Validates: Requirements 3.2**
        status = determine_status(judgment, confidence_score)

        result = EvaluationResult(
            judgment=judgment,
            status=status,
            confidence_score=confidence_score,
            reason=reason,
            failure_reason=failure_reason,
        )

        assert 0.0 <= result.confidence_score <= 1.0, (
            f"confidence_score {result.confidence_score} not in [0, 1]"
        )

    @given(
        judgment=evaluator_judgment_strategy,
        confidence_score=evaluator_confidence_strategy,
        reason=reason_strategy,
        failure_reason=failure_reason_strategy,
    )
    @settings(max_examples=100)
    def test_reason_is_non_empty_string(
        self,
        judgment: str,
        confidence_score: float,
        reason: str,
        failure_reason,
    ):
        """Parsed EvaluationResult reason must be a non-empty string."""
        # **Validates: Requirements 3.2**
        status = determine_status(judgment, confidence_score)

        result = EvaluationResult(
            judgment=judgment,
            status=status,
            confidence_score=confidence_score,
            reason=reason,
            failure_reason=failure_reason,
        )

        assert isinstance(result.reason, str) and len(result.reason) > 0, (
            f"reason must be a non-empty string, got: {result.reason!r}"
        )

    @given(
        judgment=evaluator_judgment_strategy,
        confidence_score=evaluator_confidence_strategy,
        reason=reason_strategy,
        failure_reason=failure_reason_strategy,
    )
    @settings(max_examples=100)
    def test_failure_reason_none_or_in_valid_enum_set(
        self,
        judgment: str,
        confidence_score: float,
        reason: str,
        failure_reason,
    ):
        """Parsed EvaluationResult failure_reason must be None or in the valid enum set."""
        # **Validates: Requirements 3.2**
        status = determine_status(judgment, confidence_score)

        result = EvaluationResult(
            judgment=judgment,
            status=status,
            confidence_score=confidence_score,
            reason=reason,
            failure_reason=failure_reason,
        )

        valid_failure_reasons = {
            "wrong_answer",
            "incomplete_answer",
            "hallucinated_answer",
            "wrong_source_retrieved",
            "no_source_found",
            "question_unclear",
        }
        assert result.failure_reason is None or result.failure_reason in valid_failure_reasons, (
            f"failure_reason '{result.failure_reason}' not None or in valid set {valid_failure_reasons}"
        )


# --- Strategies for Property 3 ---

# Generate non-empty ai_answer strings
ai_answer_strategy = st.text(min_size=1, max_size=300).filter(lambda s: s.strip() != "")

# Generate non-empty reference_answer strings
reference_answer_strategy = st.text(min_size=1, max_size=300).filter(lambda s: s.strip() != "")


# --- Property 3 Tests ---

# Feature: ai-accuracy-testing, Property 3: Evaluator prompt completeness
class TestEvaluatorPromptCompleteness:
    """
    Property 3: Evaluator prompt completeness.

    For any (question, ai_answer, source_evidence, reference_answer) tuple, the
    constructed evaluator prompt SHALL contain all four input components and
    instructions to judge only against source evidence.
    """

    @given(
        question=question_strategy,
        ai_answer=ai_answer_strategy,
        source_evidence=source_evidence_strategy,
        reference_answer=reference_answer_strategy,
    )
    @settings(max_examples=100)
    def test_prompt_contains_question(
        self, question: str, ai_answer: str, source_evidence: list[dict], reference_answer: str
    ):
        """The evaluator prompt must contain the question."""
        # **Validates: Requirements 3.1, 3.3**
        prompt = build_evaluator_prompt(question, ai_answer, source_evidence, reference_answer)
        assert question in prompt, (
            f"Question not found in evaluator prompt. Question: {question!r}"
        )

    @given(
        question=question_strategy,
        ai_answer=ai_answer_strategy,
        source_evidence=source_evidence_strategy,
        reference_answer=reference_answer_strategy,
    )
    @settings(max_examples=100)
    def test_prompt_contains_ai_answer(
        self, question: str, ai_answer: str, source_evidence: list[dict], reference_answer: str
    ):
        """The evaluator prompt must contain the ai_answer."""
        # **Validates: Requirements 3.1, 3.3**
        prompt = build_evaluator_prompt(question, ai_answer, source_evidence, reference_answer)
        assert ai_answer in prompt, (
            f"AI answer not found in evaluator prompt. AI answer: {ai_answer!r}"
        )

    @given(
        question=question_strategy,
        ai_answer=ai_answer_strategy,
        source_evidence=source_evidence_strategy,
        reference_answer=reference_answer_strategy,
    )
    @settings(max_examples=100)
    def test_prompt_contains_reference_answer(
        self, question: str, ai_answer: str, source_evidence: list[dict], reference_answer: str
    ):
        """The evaluator prompt must contain the reference_answer."""
        # **Validates: Requirements 3.1, 3.3**
        prompt = build_evaluator_prompt(question, ai_answer, source_evidence, reference_answer)
        assert reference_answer in prompt, (
            f"Reference answer not found in evaluator prompt. Reference answer: {reference_answer!r}"
        )

    @given(
        question=question_strategy,
        ai_answer=ai_answer_strategy,
        source_evidence=source_evidence_strategy,
        reference_answer=reference_answer_strategy,
    )
    @settings(max_examples=100)
    def test_prompt_contains_all_chunk_contents(
        self, question: str, ai_answer: str, source_evidence: list[dict], reference_answer: str
    ):
        """The evaluator prompt must contain all chunk content values from source_evidence."""
        # **Validates: Requirements 3.1, 3.3**
        prompt = build_evaluator_prompt(question, ai_answer, source_evidence, reference_answer)
        for i, chunk in enumerate(source_evidence):
            content = chunk["content"]
            assert content in prompt, (
                f"Chunk {i} content not found in evaluator prompt. Content: {content!r}"
            )

    @given(
        question=question_strategy,
        ai_answer=ai_answer_strategy,
        source_evidence=source_evidence_strategy,
        reference_answer=reference_answer_strategy,
    )
    @settings(max_examples=100)
    def test_prompt_contains_source_only_judgment_instruction(
        self, question: str, ai_answer: str, source_evidence: list[dict], reference_answer: str
    ):
        """The evaluator prompt must contain instructions to judge only against source evidence (not general knowledge)."""
        # **Validates: Requirements 3.1, 3.3**
        prompt = build_evaluator_prompt(question, ai_answer, source_evidence, reference_answer)
        assert "do not use general knowledge" in prompt.lower(), (
            "Evaluator prompt missing instruction to judge only against source evidence"
        )
