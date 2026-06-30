# Feature: ai-accuracy-testing, Property 1: Accuracy test creation preserves input data
# Feature: ai-accuracy-testing, Property 6: Test list ordering invariant
# Feature: ai-accuracy-testing, Property 8: Summary metrics correctness
# Feature: ai-accuracy-testing, Property 9: Document filter correctness
"""
Property-based tests for the accuracy tests API router.

Property 1: Accuracy test creation preserves input data
- For any valid combination of (document_id, question, ai_answer, source_evidence),
  creating an accuracy test via create_accuracy_test SHALL produce a database insert
  payload where document_id, question, ai_answer, and source_evidence are identical
  to the input values.

Validates: Requirements 1.1

Property 6: Test list ordering invariant
- For any set of accuracy test records in the database, the GET /accuracy-tests
  endpoint SHALL return them ordered by created_at descending (most recent first).

Validates: Requirements 4.2

Property 8: Summary metrics correctness
- For any set of accuracy test records, the GET /accuracy-tests/summary endpoint
  SHALL return counts where likely_correct_count + needs_review_count +
  incorrect_count + human_approved_count + human_rejected_count equals the sum
  of records in each respective status category, and average_confidence equals
  the arithmetic mean of all non-null confidence_score values.

Validates: Requirements 4.5

Property 9: Document filter correctness
- For any document_id filter applied to the accuracy test list, all returned records
  SHALL have document_id equal to the filter value, and no records with that document_id
  SHALL be excluded from the result.

Validates: Requirements 4.2, 6.7
"""

from unittest.mock import patch, MagicMock
from uuid import uuid4

from hypothesis import given, settings, assume
from hypothesis import strategies as st

from app.api.routes.accuracy_tests import (
    create_accuracy_test,
    list_accuracy_tests,
    get_accuracy_tests_summary,
)
from app.models.accuracy_test import AccuracyTestCreateRequest


# --- Strategies ---

# Generate valid UUID strings
uuid_strategy = st.uuids().map(str)

# Generate non-empty question strings (strip must be non-empty)
question_strategy = st.text(min_size=1, max_size=200).filter(lambda s: s.strip() != "")

# Generate non-empty ai_answer strings (strip must be non-empty)
ai_answer_strategy = st.text(min_size=1, max_size=200).filter(lambda s: s.strip() != "")

# Generate source evidence chunks: list of dicts with "content" and "page_number"
chunk_strategy = st.fixed_dictionaries({
    "content": st.text(min_size=1, max_size=300).filter(lambda s: s.strip() != ""),
    "page_number": st.integers(min_value=1, max_value=1000),
})

source_evidence_strategy = st.lists(chunk_strategy, min_size=1, max_size=5)

# Generate document_id: either None or a valid UUID string
document_id_strategy = st.one_of(
    st.none(),
    st.uuids().map(str),
)

# Valid status values for accuracy tests
status_strategy = st.sampled_from([
    "likely_correct", "needs_review", "incorrect", "human_approved", "human_rejected"
])

# Generate a single accuracy test record dict
def record_strategy(document_id_strategy):
    """Generate an accuracy test record with a given document_id strategy."""
    return st.fixed_dictionaries({
        "id": st.uuids().map(str),
        "document_id": document_id_strategy,
        "question": st.text(min_size=1, max_size=100).filter(lambda s: s.strip() != ""),
        "ai_answer": st.text(min_size=1, max_size=100).filter(lambda s: s.strip() != ""),
        "source_evidence": st.just([]),
        "reference_answer": st.text(min_size=1, max_size=100),
        "judgment": st.sampled_from([
            "supported_by_source", "partially_supported", "unsupported",
            "missing_information", "possible_hallucination", "insufficient_evidence"
        ]),
        "status": status_strategy,
        "confidence_score": st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
        "reason": st.text(min_size=1, max_size=100),
        "failure_reason": st.one_of(st.none(), st.sampled_from([
            "wrong_answer", "incomplete_answer", "hallucinated_answer",
            "wrong_source_retrieved", "no_source_found", "question_unclear"
        ])),
        "human_status": st.one_of(st.none(), st.sampled_from(["human_approved", "human_rejected"])),
        "human_notes": st.one_of(st.none(), st.text(min_size=1, max_size=50)),
        "created_at": st.just("2024-01-15T10:30:00Z"),
    })


# --- Property 1 Tests ---

class TestAccuracyTestCreationPreservesInputData:
    """
    Property 1: Accuracy test creation preserves input data.

    For any valid combination of (document_id, question, ai_answer, source_evidence),
    creating an accuracy test SHALL produce a record where document_id, question,
    ai_answer, and source_evidence are identical to the input values.
    """

    @given(
        question=question_strategy,
        ai_answer=ai_answer_strategy,
        source_evidence=source_evidence_strategy,
        document_id=document_id_strategy,
    )
    @settings(max_examples=100)
    @patch("app.api.routes.accuracy_tests.evaluate_accuracy")
    @patch("app.api.routes.accuracy_tests.generate_reference_answer")
    @patch("app.api.routes.accuracy_tests.supabase")
    def test_input_fields_preserved_in_insert_payload(
        self,
        mock_supabase: MagicMock,
        mock_generate_ref: MagicMock,
        mock_evaluate: MagicMock,
        question: str,
        ai_answer: str,
        source_evidence: list,
        document_id,
    ):
        """
        The payload passed to supabase insert has identical values for
        document_id, question, ai_answer, and source_evidence.

        **Validates: Requirements 1.1**
        """
        # Mock the reference answer generator
        mock_generate_ref.return_value = "A mock reference answer."

        # Mock the evaluator to return a valid EvaluationResult-like object
        mock_eval_result = MagicMock()
        mock_eval_result.judgment = "supported_by_source"
        mock_eval_result.status = "likely_correct"
        mock_eval_result.confidence_score = 0.85
        mock_eval_result.reason = "Mock evaluation reason."
        mock_eval_result.failure_reason = None
        mock_evaluate.return_value = mock_eval_result

        # Mock supabase insert chain
        mock_insert_response = MagicMock()
        mock_insert_response.data = [{
            "id": str(uuid4()),
            "document_id": document_id,
            "question": question.strip(),
            "ai_answer": ai_answer.strip(),
            "source_evidence": source_evidence,
            "reference_answer": "A mock reference answer.",
            "judgment": "supported_by_source",
            "status": "likely_correct",
            "confidence_score": 0.85,
            "reason": "Mock evaluation reason.",
            "failure_reason": None,
            "human_status": None,
            "human_notes": None,
            "created_at": "2024-01-15T10:30:00Z",
        }]

        mock_table = MagicMock()
        mock_table.insert.return_value.execute.return_value = mock_insert_response
        mock_supabase.table.return_value = mock_table

        # Create the request
        request = AccuracyTestCreateRequest(
            document_id=document_id,
            question=question,
            ai_answer=ai_answer,
            source_evidence=source_evidence,
        )

        # Call the endpoint function
        create_accuracy_test(request)

        # Verify supabase insert was called
        mock_table.insert.assert_called_once()
        insert_payload = mock_table.insert.call_args[0][0]

        # Assert: input fields are preserved exactly
        assert insert_payload["document_id"] == document_id, (
            f"document_id mismatch: expected {document_id!r}, got {insert_payload['document_id']!r}"
        )
        assert insert_payload["question"] == question.strip(), (
            f"question mismatch: expected {question.strip()!r}, got {insert_payload['question']!r}"
        )
        assert insert_payload["ai_answer"] == ai_answer.strip(), (
            f"ai_answer mismatch: expected {ai_answer.strip()!r}, got {insert_payload['ai_answer']!r}"
        )
        assert insert_payload["source_evidence"] == source_evidence, (
            f"source_evidence mismatch: expected {source_evidence!r}, got {insert_payload['source_evidence']!r}"
        )


# --- Strategies for Property 6 ---

# Generate ISO timestamp strings with random dates
iso_timestamp_strategy = st.datetimes(
    min_value=st.DateTimeStrategy.min_value if hasattr(st, 'DateTimeStrategy') else None,
).map(lambda dt: dt.isoformat() + "Z") if False else st.builds(
    lambda year, month, day, hour, minute, second: f"{year:04d}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:{second:02d}Z",
    year=st.integers(min_value=2020, max_value=2025),
    month=st.integers(min_value=1, max_value=12),
    day=st.integers(min_value=1, max_value=28),
    hour=st.integers(min_value=0, max_value=23),
    minute=st.integers(min_value=0, max_value=59),
    second=st.integers(min_value=0, max_value=59),
)


def build_record_with_timestamp(created_at: str) -> dict:
    """Build a minimal accuracy test record with a given created_at timestamp."""
    return {
        "id": str(uuid4()),
        "document_id": str(uuid4()),
        "question": "Test question",
        "ai_answer": "Test answer",
        "source_evidence": [],
        "reference_answer": "Test reference",
        "judgment": "supported_by_source",
        "status": "likely_correct",
        "confidence_score": 0.85,
        "reason": "Test reason",
        "failure_reason": None,
        "human_status": None,
        "human_notes": None,
        "created_at": created_at,
    }


# --- Property 6 Tests ---
# Feature: ai-accuracy-testing, Property 6: Test list ordering invariant

class TestListOrderingInvariant:
    """
    Property 6: Test list ordering invariant.

    For any set of accuracy test records in the database, the GET /accuracy-tests
    endpoint SHALL return them ordered by created_at descending (most recent first).

    **Validates: Requirements 4.2**
    """

    @given(
        timestamps=st.lists(iso_timestamp_strategy, min_size=1, max_size=20),
    )
    @settings(max_examples=100)
    def test_order_call_uses_created_at_desc(self, timestamps: list[str]):
        """
        The query chain must call .order("created_at", desc=True) to ensure
        results are ordered by created_at descending.

        **Validates: Requirements 4.2**
        """
        # Build records with random timestamps
        records = [build_record_with_timestamp(ts) for ts in timestamps]

        # Sort descending by created_at (simulating what supabase would return)
        sorted_records = sorted(records, key=lambda r: r["created_at"], reverse=True)

        # Mock the supabase query chain
        mock_execute = MagicMock()
        mock_execute.execute.return_value = MagicMock(data=sorted_records)

        mock_order = MagicMock()
        mock_order.order.return_value = mock_execute

        mock_select = MagicMock()
        mock_select.select.return_value = mock_order

        with patch("app.api.routes.accuracy_tests.supabase") as mock_supabase:
            mock_supabase.table.return_value = mock_select

            list_accuracy_tests(document_id=None)

        # Verify .order() was called with created_at descending
        mock_order.order.assert_called_once_with("created_at", desc=True)

    @given(
        timestamps=st.lists(iso_timestamp_strategy, min_size=1, max_size=20),
    )
    @settings(max_examples=100)
    def test_response_preserves_supabase_ordering(self, timestamps: list[str]):
        """
        The function SHALL pass through records from supabase unchanged,
        preserving the order that supabase returned (which is created_at desc).

        **Validates: Requirements 4.2**
        """
        # Build records with random timestamps
        records = [build_record_with_timestamp(ts) for ts in timestamps]

        # Sort descending by created_at (simulating what supabase would return)
        sorted_records = sorted(records, key=lambda r: r["created_at"], reverse=True)

        # Mock the supabase query chain
        mock_execute = MagicMock()
        mock_execute.execute.return_value = MagicMock(data=sorted_records)

        mock_order = MagicMock()
        mock_order.order.return_value = mock_execute

        mock_select = MagicMock()
        mock_select.select.return_value = mock_order

        with patch("app.api.routes.accuracy_tests.supabase") as mock_supabase:
            mock_supabase.table.return_value = mock_select

            result = list_accuracy_tests(document_id=None)

        # Verify the result is in the same order as the sorted records
        assert len(result) == len(sorted_records), (
            f"Expected {len(sorted_records)} records, got {len(result)}"
        )

        # Verify ordering is preserved (created_at descending)
        result_timestamps = [r["created_at"] for r in result]
        expected_timestamps = [r["created_at"] for r in sorted_records]
        assert result_timestamps == expected_timestamps, (
            f"Result ordering does not match expected descending order.\n"
            f"Expected: {expected_timestamps}\n"
            f"Got: {result_timestamps}"
        )

    @given(
        timestamps=st.lists(iso_timestamp_strategy, min_size=2, max_size=20),
    )
    @settings(max_examples=100)
    def test_returned_records_are_in_descending_created_at_order(self, timestamps: list[str]):
        """
        Given supabase returns pre-ordered records (desc by created_at),
        the result must satisfy the invariant: each record's created_at
        is >= the next record's created_at.

        **Validates: Requirements 4.2**
        """
        # Build records with random timestamps
        records = [build_record_with_timestamp(ts) for ts in timestamps]

        # Sort descending by created_at (simulating supabase ordering)
        sorted_records = sorted(records, key=lambda r: r["created_at"], reverse=True)

        # Mock the supabase query chain
        mock_execute = MagicMock()
        mock_execute.execute.return_value = MagicMock(data=sorted_records)

        mock_order = MagicMock()
        mock_order.order.return_value = mock_execute

        mock_select = MagicMock()
        mock_select.select.return_value = mock_order

        with patch("app.api.routes.accuracy_tests.supabase") as mock_supabase:
            mock_supabase.table.return_value = mock_select

            result = list_accuracy_tests(document_id=None)

        # Verify the ordering invariant: each created_at >= next created_at
        for i in range(len(result) - 1):
            assert result[i]["created_at"] >= result[i + 1]["created_at"], (
                f"Ordering violation at index {i}: "
                f"{result[i]['created_at']} should be >= {result[i + 1]['created_at']}"
            )


# --- Property 9 Tests ---

class TestDocumentFilterCorrectness:
    """
    Property 9: Document filter correctness.

    For any document_id filter applied to the accuracy test list, all returned records
    SHALL have document_id equal to the filter value, and no records with that document_id
    SHALL be excluded from the result.
    """

    @given(
        target_doc_id=uuid_strategy,
        other_doc_ids=st.lists(uuid_strategy, min_size=1, max_size=5),
        matching_count=st.integers(min_value=0, max_value=5),
        non_matching_count=st.integers(min_value=0, max_value=5),
    )
    @settings(max_examples=100)
    def test_filter_returns_only_matching_records(
        self,
        target_doc_id: str,
        other_doc_ids: list,
        matching_count: int,
        non_matching_count: int,
    ):
        """
        When document_id filter is applied, the supabase query chain correctly
        filters records so that only records with the target document_id are returned.

        We simulate the filtering behavior by providing supabase mock that returns
        only the matching records (as real supabase would after .eq() filtering).
        Then we verify the function returns exactly those records.

        **Validates: Requirements 4.2, 6.7**
        """
        # Ensure other_doc_ids don't contain target_doc_id
        other_doc_ids = [d for d in other_doc_ids if d != target_doc_id]
        if not other_doc_ids:
            other_doc_ids = [str(uuid4())]

        # Build matching records (with target document_id)
        matching_records = []
        for i in range(matching_count):
            matching_records.append({
                "id": str(uuid4()),
                "document_id": target_doc_id,
                "question": f"Question {i}",
                "ai_answer": f"Answer {i}",
                "source_evidence": [],
                "reference_answer": f"Reference {i}",
                "judgment": "supported_by_source",
                "status": "likely_correct",
                "confidence_score": 0.85,
                "reason": "Test reason",
                "failure_reason": None,
                "human_status": None,
                "human_notes": None,
                "created_at": "2024-01-15T10:30:00Z",
            })

        # Mock supabase to return only matching records (simulating .eq() filter)
        mock_execute = MagicMock()
        mock_execute.execute.return_value = MagicMock(data=matching_records)

        mock_order = MagicMock()
        mock_order.order.return_value = mock_execute

        mock_eq = MagicMock()
        mock_eq.eq.return_value = mock_order

        mock_select = MagicMock()
        mock_select.select.return_value = mock_eq

        with patch("app.api.routes.accuracy_tests.supabase") as mock_supabase:
            mock_supabase.table.return_value = mock_select

            result = list_accuracy_tests(document_id=target_doc_id)

        # Verify: all returned records have the target document_id
        for record in result:
            assert record["document_id"] == target_doc_id, (
                f"Returned record has document_id={record['document_id']!r}, "
                f"expected {target_doc_id!r}"
            )

        # Verify: no matching records were excluded
        assert len(result) == matching_count, (
            f"Expected {matching_count} records, got {len(result)}"
        )

    @given(
        target_doc_id=uuid_strategy,
        other_doc_ids=st.lists(uuid_strategy, min_size=1, max_size=5),
    )
    @settings(max_examples=100)
    def test_filter_calls_eq_with_correct_document_id(
        self,
        target_doc_id: str,
        other_doc_ids: list,
    ):
        """
        When document_id filter is provided, the query chain must call .eq()
        with "document_id" and the correct filter value.

        **Validates: Requirements 4.2, 6.7**
        """
        # Ensure other_doc_ids don't contain target_doc_id
        other_doc_ids = [d for d in other_doc_ids if d != target_doc_id]

        # Mock the full supabase query chain
        mock_execute = MagicMock()
        mock_execute.execute.return_value = MagicMock(data=[])

        mock_order = MagicMock()
        mock_order.order.return_value = mock_execute

        mock_eq = MagicMock()
        mock_eq.eq.return_value = mock_order

        mock_select = MagicMock()
        mock_select.select.return_value = mock_eq

        with patch("app.api.routes.accuracy_tests.supabase") as mock_supabase:
            mock_supabase.table.return_value = mock_select

            list_accuracy_tests(document_id=target_doc_id)

        # Verify .eq() was called with the correct document_id
        mock_eq.eq.assert_called_once_with("document_id", target_doc_id)

    @given(
        target_doc_id=uuid_strategy,
        total_records=st.integers(min_value=1, max_value=10),
    )
    @settings(max_examples=100)
    def test_no_matching_records_excluded(
        self,
        target_doc_id: str,
        total_records: int,
    ):
        """
        When supabase returns filtered records, ALL of them must be present in
        the function's return value — no matching records are dropped.

        **Validates: Requirements 4.2, 6.7**
        """
        # Build records that all match the target document_id
        all_matching = []
        for i in range(total_records):
            all_matching.append({
                "id": str(uuid4()),
                "document_id": target_doc_id,
                "question": f"Question {i}",
                "ai_answer": f"Answer {i}",
                "source_evidence": [],
                "reference_answer": f"Reference {i}",
                "judgment": "supported_by_source",
                "status": "likely_correct",
                "confidence_score": 0.9,
                "reason": "Reason",
                "failure_reason": None,
                "human_status": None,
                "human_notes": None,
                "created_at": f"2024-01-{15 - i:02d}T10:30:00Z",
            })

        # Mock supabase to return all matching records
        mock_execute = MagicMock()
        mock_execute.execute.return_value = MagicMock(data=all_matching)

        mock_order = MagicMock()
        mock_order.order.return_value = mock_execute

        mock_eq = MagicMock()
        mock_eq.eq.return_value = mock_order

        mock_select = MagicMock()
        mock_select.select.return_value = mock_eq

        with patch("app.api.routes.accuracy_tests.supabase") as mock_supabase:
            mock_supabase.table.return_value = mock_select

            result = list_accuracy_tests(document_id=target_doc_id)

        # Verify: every matching record's ID is present in the result
        result_ids = {r["id"] for r in result}
        expected_ids = {r["id"] for r in all_matching}
        assert result_ids == expected_ids, (
            f"Missing records from result. Expected IDs: {expected_ids}, Got: {result_ids}"
        )

        # Verify count
        assert len(result) == total_records, (
            f"Expected {total_records} records, got {len(result)}"
        )

    @given(target_doc_id=uuid_strategy)
    @settings(max_examples=100)
    def test_empty_result_when_no_matching_records(self, target_doc_id: str):
        """
        When no records match the document_id filter, the function returns an empty list.

        **Validates: Requirements 4.2, 6.7**
        """
        # Mock supabase to return empty result (no matches)
        mock_execute = MagicMock()
        mock_execute.execute.return_value = MagicMock(data=[])

        mock_order = MagicMock()
        mock_order.order.return_value = mock_execute

        mock_eq = MagicMock()
        mock_eq.eq.return_value = mock_order

        mock_select = MagicMock()
        mock_select.select.return_value = mock_eq

        with patch("app.api.routes.accuracy_tests.supabase") as mock_supabase:
            mock_supabase.table.return_value = mock_select

            result = list_accuracy_tests(document_id=target_doc_id)

        assert result == [], (
            f"Expected empty list when no records match, got {result}"
        )


# --- Strategies for Property 8 ---

# Confidence score: either None or a float between 0.0 and 1.0
summary_confidence_strategy = st.one_of(
    st.none(),
    st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
)

# Generate a single test record dict (as returned from supabase) for summary testing
summary_record_strategy = st.fixed_dictionaries({
    "id": st.uuids().map(str),
    "status": status_strategy,
    "confidence_score": summary_confidence_strategy,
    "question": st.text(min_size=1, max_size=50),
    "ai_answer": st.text(min_size=1, max_size=50),
})

# Generate a list of test records (0 to 50 records)
summary_records_strategy = st.lists(summary_record_strategy, min_size=0, max_size=50)


# --- Property 8 Tests ---

class TestSummaryMetricsCorrectness:
    """
    Property 8: Summary metrics correctness.

    For any set of accuracy test records, the GET /accuracy-tests/summary endpoint
    SHALL return counts where each status count matches the number of records with
    that status, total_tests equals the number of records, and average_confidence
    equals the arithmetic mean of all non-null confidence_score values (or 0.0 if none).

    **Validates: Requirements 4.5**
    """

    @given(records=summary_records_strategy)
    @settings(max_examples=100)
    @patch("app.api.routes.accuracy_tests.supabase")
    def test_total_tests_equals_record_count(self, mock_supabase, records: list[dict]):
        """total_tests must equal the number of records."""
        # **Validates: Requirements 4.5**
        mock_response = MagicMock()
        mock_response.data = records
        mock_supabase.table.return_value.select.return_value.execute.return_value = mock_response

        result = get_accuracy_tests_summary()

        assert result.total_tests == len(records), (
            f"Expected total_tests={len(records)}, got {result.total_tests}"
        )

    @given(records=summary_records_strategy)
    @settings(max_examples=100)
    @patch("app.api.routes.accuracy_tests.supabase")
    def test_likely_correct_count_matches(self, mock_supabase, records: list[dict]):
        """likely_correct_count must match records with status=='likely_correct'."""
        # **Validates: Requirements 4.5**
        mock_response = MagicMock()
        mock_response.data = records
        mock_supabase.table.return_value.select.return_value.execute.return_value = mock_response

        result = get_accuracy_tests_summary()

        expected = sum(1 for r in records if r.get("status") == "likely_correct")
        assert result.likely_correct_count == expected, (
            f"Expected likely_correct_count={expected}, got {result.likely_correct_count}"
        )

    @given(records=summary_records_strategy)
    @settings(max_examples=100)
    @patch("app.api.routes.accuracy_tests.supabase")
    def test_needs_review_count_matches(self, mock_supabase, records: list[dict]):
        """needs_review_count must match records with status=='needs_review'."""
        # **Validates: Requirements 4.5**
        mock_response = MagicMock()
        mock_response.data = records
        mock_supabase.table.return_value.select.return_value.execute.return_value = mock_response

        result = get_accuracy_tests_summary()

        expected = sum(1 for r in records if r.get("status") == "needs_review")
        assert result.needs_review_count == expected, (
            f"Expected needs_review_count={expected}, got {result.needs_review_count}"
        )

    @given(records=summary_records_strategy)
    @settings(max_examples=100)
    @patch("app.api.routes.accuracy_tests.supabase")
    def test_incorrect_count_matches(self, mock_supabase, records: list[dict]):
        """incorrect_count must match records with status=='incorrect'."""
        # **Validates: Requirements 4.5**
        mock_response = MagicMock()
        mock_response.data = records
        mock_supabase.table.return_value.select.return_value.execute.return_value = mock_response

        result = get_accuracy_tests_summary()

        expected = sum(1 for r in records if r.get("status") == "incorrect")
        assert result.incorrect_count == expected, (
            f"Expected incorrect_count={expected}, got {result.incorrect_count}"
        )

    @given(records=summary_records_strategy)
    @settings(max_examples=100)
    @patch("app.api.routes.accuracy_tests.supabase")
    def test_human_approved_count_matches(self, mock_supabase, records: list[dict]):
        """human_approved_count must match records with status=='human_approved'."""
        # **Validates: Requirements 4.5**
        mock_response = MagicMock()
        mock_response.data = records
        mock_supabase.table.return_value.select.return_value.execute.return_value = mock_response

        result = get_accuracy_tests_summary()

        expected = sum(1 for r in records if r.get("status") == "human_approved")
        assert result.human_approved_count == expected, (
            f"Expected human_approved_count={expected}, got {result.human_approved_count}"
        )

    @given(records=summary_records_strategy)
    @settings(max_examples=100)
    @patch("app.api.routes.accuracy_tests.supabase")
    def test_human_rejected_count_matches(self, mock_supabase, records: list[dict]):
        """human_rejected_count must match records with status=='human_rejected'."""
        # **Validates: Requirements 4.5**
        mock_response = MagicMock()
        mock_response.data = records
        mock_supabase.table.return_value.select.return_value.execute.return_value = mock_response

        result = get_accuracy_tests_summary()

        expected = sum(1 for r in records if r.get("status") == "human_rejected")
        assert result.human_rejected_count == expected, (
            f"Expected human_rejected_count={expected}, got {result.human_rejected_count}"
        )

    @given(records=summary_records_strategy)
    @settings(max_examples=100)
    @patch("app.api.routes.accuracy_tests.supabase")
    def test_average_confidence_matches_arithmetic_mean(self, mock_supabase, records: list[dict]):
        """average_confidence must equal arithmetic mean of non-null confidence_scores (or 0.0 if none)."""
        # **Validates: Requirements 4.5**
        mock_response = MagicMock()
        mock_response.data = records
        mock_supabase.table.return_value.select.return_value.execute.return_value = mock_response

        result = get_accuracy_tests_summary()

        non_null_scores = [
            r["confidence_score"]
            for r in records
            if r.get("confidence_score") is not None
        ]
        if non_null_scores:
            expected_avg = round(sum(non_null_scores) / len(non_null_scores), 2)
        else:
            expected_avg = 0.0

        assert abs(result.average_confidence - expected_avg) < 1e-9, (
            f"Expected average_confidence={expected_avg}, got {result.average_confidence}. "
            f"Non-null scores: {non_null_scores}"
        )
