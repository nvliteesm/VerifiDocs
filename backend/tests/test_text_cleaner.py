"""
Tests for app.rag.text_cleaner — basic PDF text cleanup.
"""

from app.rag.text_cleaner import clean_text


class TestCleanText:
    def test_removes_null_bytes(self):
        assert clean_text("hello\x00world") == "hello world"

    def test_collapses_whitespace(self):
        assert clean_text("hello   world") == "hello world"

    def test_collapses_newlines_and_tabs(self):
        assert clean_text("hello\n\n\tworld") == "hello world"

    def test_strips_leading_trailing_whitespace(self):
        assert clean_text("  hello world  ") == "hello world"

    def test_empty_string(self):
        assert clean_text("") == ""

    def test_only_whitespace(self):
        assert clean_text("   \n\t  ") == ""

    def test_normal_text_unchanged(self):
        text = "This is normal text."
        assert clean_text(text) == text
