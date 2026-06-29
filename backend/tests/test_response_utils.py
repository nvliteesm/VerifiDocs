"""
Tests for app.rag.response_utils — the canonical utility module for
confidence scoring, source formatting, and preview generation.
"""

from app.rag.response_utils import calculate_confidence, format_sources, build_preview


class TestCalculateConfidence:
    def test_empty_chunks_returns_not_found(self):
        level, reason = calculate_confidence([])
        assert level == "not_found"
        assert "No relevant" in reason

    def test_all_low_similarity_returns_not_found(self):
        chunks = [{"similarity": 0.10}, {"similarity": 0.20}]
        level, _ = calculate_confidence(chunks)
        assert level == "not_found"

    def test_single_medium_similarity_returns_medium(self):
        chunks = [{"similarity": 0.42}]
        level, _ = calculate_confidence(chunks)
        assert level == "medium"

    def test_high_with_multiple_strong_sources(self):
        chunks = [
            {"similarity": 0.65},
            {"similarity": 0.50},
            {"similarity": 0.30},
        ]
        level, _ = calculate_confidence(chunks)
        assert level == "high"

    def test_single_high_but_no_strong_backup_returns_medium(self):
        chunks = [{"similarity": 0.62}, {"similarity": 0.20}]
        level, _ = calculate_confidence(chunks)
        # Only 1 strong source (>=0.45), not 2, so not "high"
        assert level == "medium"

    def test_low_similarity_above_025_below_040(self):
        chunks = [{"similarity": 0.30}]
        level, _ = calculate_confidence(chunks)
        assert level == "low"

    def test_missing_similarity_treated_as_zero(self):
        chunks = [{}]
        level, _ = calculate_confidence(chunks)
        assert level == "not_found"

    def test_boundary_exactly_040(self):
        chunks = [{"similarity": 0.40}]
        level, _ = calculate_confidence(chunks)
        assert level == "medium"

    def test_boundary_exactly_025(self):
        chunks = [{"similarity": 0.25}]
        level, _ = calculate_confidence(chunks)
        assert level == "low"


class TestFormatSources:
    def test_basic_formatting(self):
        chunks = [
            {
                "document_id": "abc-123",
                "chunk_index": 0,
                "page_number": 1,
                "similarity": 0.123456789,
                "content": "Hello world",
            }
        ]
        result = format_sources(chunks)

        assert len(result) == 1
        source = result[0]
        assert source["document_id"] == "abc-123"
        assert source["chunk_index"] == 0
        assert source["page_number"] == 1
        assert source["similarity"] == 0.1235  # rounded to 4 decimals
        assert source["preview"] == "Hello world"

    def test_missing_fields_default_to_none(self):
        chunks = [{}]
        result = format_sources(chunks)

        source = result[0]
        assert source["document_id"] is None
        assert source["chunk_index"] is None
        assert source["page_number"] is None
        assert source["similarity"] == 0.0
        assert source["preview"] == ""

    def test_multiple_chunks(self):
        chunks = [
            {"document_id": "a", "chunk_index": 0, "page_number": 1, "similarity": 0.5, "content": "one"},
            {"document_id": "b", "chunk_index": 1, "page_number": 2, "similarity": 0.8, "content": "two"},
        ]
        result = format_sources(chunks)
        assert len(result) == 2


class TestBuildPreview:
    def test_short_text_unchanged(self):
        text = "This is a short text."
        assert build_preview(text) == text

    def test_exactly_280_chars_unchanged(self):
        text = "a" * 280
        assert build_preview(text) == text

    def test_281_chars_truncated(self):
        text = "a" * 281
        result = build_preview(text)
        assert result == "a" * 280 + "..."
        assert len(result) == 283

    def test_long_text_truncated(self):
        text = "word " * 100  # 500 chars
        result = build_preview(text)
        assert len(result) <= 283
        assert result.endswith("...")

    def test_whitespace_stripped(self):
        text = "   hello   "
        assert build_preview(text) == "hello"

    def test_empty_string(self):
        assert build_preview("") == ""
