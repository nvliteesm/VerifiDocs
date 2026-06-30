# Feature: ai-accuracy-testing, Property 10: Save payload integrity
"""
Property-based test for save payload integrity.

Property 10: Save payload integrity
- For any chat response containing (document_id, question, ai_answer, source_evidence),
  creating an accuracy test SHALL send a POST payload where all four fields match the
  original chat response values exactly, including source_evidence format with similarity field.

Validates: Requirements 7.2
"""

from unittest.mock import patch, MagicMock
from uuid import uuid4

from hypothesis import given, settings
from hypothesis import strategies as st

from app.api.routes.accuracy_tests import create_accuracy_test
from app.models.accuracy_test import AccuracyTestCreateRequest


# --- Strategies ---

# Generate document_id: either None or a valid UUID string
document_id_strategy = st.one_of(
    st.none(),
    st.uuids().map(str),
)

# Generate non-empty question strings (strip must be non-empty)
question_strategy = st.text(min_size=1, max_size=200).filter(lambda s: s.strip() != "")

# Generate non-empty ai_answer strings (strip must be non-empty)
ai_answer_strategy = st.text(min_size=1, max_size=200).filter(lambda s: s.strip() != "")

# Generate source evidence chunks with content, page_number, and similarity
source_evidence_chunk_strategy = st.fixed_dictionaries({
    "content": st.text(min_size=1, max_size=300).filter(lambda s: s.strip() != ""),
    "page_number": st.one_of(
        st.none(),
        st.integers(min_value=1, max_value=1000),
    ),
    "similarity": st.one_of(
        st.none(),
        st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
    ),
})

source_evidence_strategy = st.lists(source_evidence_chunk_strategy, min_size=1, max_size=5)


# --- Property 10 Tests ---

class TestSavePayloadIntegrity:
    """
    Property 10: Save payload integrity.

    For any chat response containing (document_id, question, ai_answer, source_evidence),
    creating an accuracy test SHALL send a POST payload to supabase where all four
    fields match the original chat response values exactly.

    **Validates: Requirements 7.2**
    """

    @given(
        document_id=document_id_strategy,
        question=question_strategy,
        ai_answer=ai_answer_strategy,
        source_evidence=source_evidence_strategy,
    )
    @settings(max_examples=100)
    @patch("app.api.routes.accuracy_tests.evaluate_accuracy")
    @patch("app.api.routes.accuracy_tests.generate_reference_answer")
    @patch("app.api.routes.accuracy_tests.supabase")
    def test_payload_document_id_matches_input(
        self,
        mock_supabase: MagicMock,
        mock_generate_ref: MagicMock,
        mock_evaluate: MagicMock,
        document_id,
        question: str,
        ai_answer: str,
        source_evidence: list,
    ):
        """
        The payload["document_id"] sent to supabase insert matches the input document_id exactly.

        **Validates: Requirements 7.2**
        """
        mock_generate_ref.return_value = "Reference answer."
        mock_eval_result = MagicMock()
        mock_eval_result.judgment = "supported_by_source"
        mock_eval_result.status = "likely_correct"
        mock_eval_result.confidence_score = 0.85
        mock_eval_result.reason = "Evaluation reason."
        mock_eval_result.failure_reason = None
        mock_evaluate.return_value = mock_eval_result

        mock_insert_response = MagicMock()
        mock_insert_response.data = [{"id": str(uuid4())}]
        mock_table = MagicMock()
        mock_table.insert.return_value.execute.return_value = mock_insert_response
        mock_supabase.table.return_value = mock_table

        request = AccuracyTestCreateRequest(
            document_id=document_id,
            question=question,
            ai_answer=ai_answer,
            source_evidence=source_evidence,
        )

        create_accuracy_test(request)

        mock_table.insert.assert_called_once()
        insert_payload = mock_table.insert.call_args[0][0]

        assert insert_payload["document_id"] == document_id, (
            f"document_id mismatch: expected {document_id!r}, got {insert_payload['document_id']!r}"
        )

    @given(
        document_id=document_id_strategy,
        question=question_strategy,
        ai_answer=ai_answer_strategy,
        source_evidence=source_evidence_strategy,
    )
    @settings(max_examples=100)
    @patch("app.api.routes.accuracy_tests.evaluate_accuracy")
    @patch("app.api.routes.accuracy_tests.generate_reference_answer")
    @patch("app.api.routes.accuracy_tests.supabase")
    def test_payload_question_matches_input_stripped(
        self,
        mock_supabase: MagicMock,
        mock_generate_ref: MagicMock,
        mock_evaluate: MagicMock,
        document_id,
        question: str,
        ai_answer: str,
        source_evidence: list,
    ):
        """
        The payload["question"] sent to supabase insert matches the input question (stripped).

        **Validates: Requirements 7.2**
        """
        mock_generate_ref.return_value = "Reference answer."
        mock_eval_result = MagicMock()
        mock_eval_result.judgment = "supported_by_source"
        mock_eval_result.status = "likely_correct"
        mock_eval_result.confidence_score = 0.85
        mock_eval_result.reason = "Evaluation reason."
        mock_eval_result.failure_reason = None
        mock_evaluate.return_value = mock_eval_result

        mock_insert_response = MagicMock()
        mock_insert_response.data = [{"id": str(uuid4())}]
        mock_table = MagicMock()
        mock_table.insert.return_value.execute.return_value = mock_insert_response
        mock_supabase.table.return_value = mock_table

        request = AccuracyTestCreateRequest(
            document_id=document_id,
            question=question,
            ai_answer=ai_answer,
            source_evidence=source_evidence,
        )

        create_accuracy_test(request)

        mock_table.insert.assert_called_once()
        insert_payload = mock_table.insert.call_args[0][0]

        assert insert_payload["question"] == question.strip(), (
            f"question mismatch: expected {question.strip()!r}, got {insert_payload['question']!r}"
        )

    @given(
        document_id=document_id_strategy,
        question=question_strategy,
        ai_answer=ai_answer_strategy,
        source_evidence=source_evidence_strategy,
    )
    @settings(max_examples=100)
    @patch("app.api.routes.accuracy_tests.evaluate_accuracy")
    @patch("app.api.routes.accuracy_tests.generate_reference_answer")
    @patch("app.api.routes.accuracy_tests.supabase")
    def test_payload_ai_answer_matches_input_stripped(
        self,
        mock_supabase: MagicMock,
        mock_generate_ref: MagicMock,
        mock_evaluate: MagicMock,
        document_id,
        question: str,
        ai_answer: str,
        source_evidence: list,
    ):
        """
        The payload["ai_answer"] sent to supabase insert matches the input ai_answer (stripped).

        **Validates: Requirements 7.2**
        """
        mock_generate_ref.return_value = "Reference answer."
        mock_eval_result = MagicMock()
        mock_eval_result.judgment = "supported_by_source"
        mock_eval_result.status = "likely_correct"
        mock_eval_result.confidence_score = 0.85
        mock_eval_result.reason = "Evaluation reason."
        mock_eval_result.failure_reason = None
        mock_evaluate.return_value = mock_eval_result

        mock_insert_response = MagicMock()
        mock_insert_response.data = [{"id": str(uuid4())}]
        mock_table = MagicMock()
        mock_table.insert.return_value.execute.return_value = mock_insert_response
        mock_supabase.table.return_value = mock_table

        request = AccuracyTestCreateRequest(
            document_id=document_id,
            question=question,
            ai_answer=ai_answer,
            source_evidence=source_evidence,
        )

        create_accuracy_test(request)

        mock_table.insert.assert_called_once()
        insert_payload = mock_table.insert.call_args[0][0]

        assert insert_payload["ai_answer"] == ai_answer.strip(), (
            f"ai_answer mismatch: expected {ai_answer.strip()!r}, got {insert_payload['ai_answer']!r}"
        )

    @given(
        document_id=document_id_strategy,
        question=question_strategy,
        ai_answer=ai_answer_strategy,
        source_evidence=source_evidence_strategy,
    )
    @settings(max_examples=100)
    @patch("app.api.routes.accuracy_tests.evaluate_accuracy")
    @patch("app.api.routes.accuracy_tests.generate_reference_answer")
    @patch("app.api.routes.accuracy_tests.supabase")
    def test_payload_source_evidence_matches_input_exactly(
        self,
        mock_supabase: MagicMock,
        mock_generate_ref: MagicMock,
        mock_evaluate: MagicMock,
        document_id,
        question: str,
        ai_answer: str,
        source_evidence: list,
    ):
        """
        The payload["source_evidence"] sent to supabase insert matches the input
        source_evidence exactly, preserving content, page_number, and similarity fields.

        **Validates: Requirements 7.2**
        """
        mock_generate_ref.return_value = "Reference answer."
        mock_eval_result = MagicMock()
        mock_eval_result.judgment = "supported_by_source"
        mock_eval_result.status = "likely_correct"
        mock_eval_result.confidence_score = 0.85
        mock_eval_result.reason = "Evaluation reason."
        mock_eval_result.failure_reason = None
        mock_evaluate.return_value = mock_eval_result

        mock_insert_response = MagicMock()
        mock_insert_response.data = [{"id": str(uuid4())}]
        mock_table = MagicMock()
        mock_table.insert.return_value.execute.return_value = mock_insert_response
        mock_supabase.table.return_value = mock_table

        request = AccuracyTestCreateRequest(
            document_id=document_id,
            question=question,
            ai_answer=ai_answer,
            source_evidence=source_evidence,
        )

        create_accuracy_test(request)

        mock_table.insert.assert_called_once()
        insert_payload = mock_table.insert.call_args[0][0]

        assert insert_payload["source_evidence"] == source_evidence, (
            f"source_evidence mismatch:\n"
            f"  expected: {source_evidence!r}\n"
            f"  got: {insert_payload['source_evidence']!r}"
        )

    @given(
        document_id=document_id_strategy,
        question=question_strategy,
        ai_answer=ai_answer_strategy,
        source_evidence=source_evidence_strategy,
    )
    @settings(max_examples=100)
    @patch("app.api.routes.accuracy_tests.evaluate_accuracy")
    @patch("app.api.routes.accuracy_tests.generate_reference_answer")
    @patch("app.api.routes.accuracy_tests.supabase")
    def test_all_payload_fields_match_input_simultaneously(
        self,
        mock_supabase: MagicMock,
        mock_generate_ref: MagicMock,
        mock_evaluate: MagicMock,
        document_id,
        question: str,
        ai_answer: str,
        source_evidence: list,
    ):
        """
        All four payload fields (document_id, question, ai_answer, source_evidence)
        match the original chat response values simultaneously in a single insert call.

        **Validates: Requirements 7.2**
        """
        mock_generate_ref.return_value = "Reference answer."
        mock_eval_result = MagicMock()
        mock_eval_result.judgment = "supported_by_source"
        mock_eval_result.status = "likely_correct"
        mock_eval_result.confidence_score = 0.85
        mock_eval_result.reason = "Evaluation reason."
        mock_eval_result.failure_reason = None
        mock_evaluate.return_value = mock_eval_result

        mock_insert_response = MagicMock()
        mock_insert_response.data = [{"id": str(uuid4())}]
        mock_table = MagicMock()
        mock_table.insert.return_value.execute.return_value = mock_insert_response
        mock_supabase.table.return_value = mock_table

        request = AccuracyTestCreateRequest(
            document_id=document_id,
            question=question,
            ai_answer=ai_answer,
            source_evidence=source_evidence,
        )

        create_accuracy_test(request)

        mock_table.insert.assert_called_once()
        insert_payload = mock_table.insert.call_args[0][0]

        # Verify all four fields simultaneously
        assert insert_payload["document_id"] == document_id
        assert insert_payload["question"] == question.strip()
        assert insert_payload["ai_answer"] == ai_answer.strip()
        assert insert_payload["source_evidence"] == source_evidence
