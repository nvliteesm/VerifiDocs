"""
Tests for app.rag.chunker — token-based PDF text chunking.
"""

from app.rag.chunker import chunk_pages


class TestChunkPages:
    def test_empty_pages_returns_empty(self):
        assert chunk_pages([]) == []

    def test_single_short_page_produces_one_chunk(self):
        pages = [{"page_number": 1, "text": "Hello world, this is a test."}]
        chunks = chunk_pages(pages)

        assert len(chunks) == 1
        assert chunks[0]["chunk_index"] == 0
        assert chunks[0]["page_number"] == 1
        assert "Hello world" in chunks[0]["content"]

    def test_preserves_page_number(self):
        pages = [
            {"page_number": 3, "text": "Page three content here."},
        ]
        chunks = chunk_pages(pages)

        assert all(c["page_number"] == 3 for c in chunks)

    def test_long_text_produces_multiple_chunks(self):
        # Generate text that will exceed 500 tokens
        long_text = "This is a sentence that contains several words. " * 200
        pages = [{"page_number": 1, "text": long_text}]
        chunks = chunk_pages(pages)

        assert len(chunks) > 1
        # Chunk indices should be sequential
        for i, chunk in enumerate(chunks):
            assert chunk["chunk_index"] == i

    def test_empty_text_page_skipped(self):
        pages = [
            {"page_number": 1, "text": ""},
            {"page_number": 2, "text": "Real content here."},
        ]
        chunks = chunk_pages(pages)

        assert len(chunks) == 1
        assert chunks[0]["page_number"] == 2

    def test_whitespace_only_page_skipped(self):
        pages = [{"page_number": 1, "text": "   \n\t  "}]
        chunks = chunk_pages(pages)

        assert len(chunks) == 0

    def test_multiple_pages_chunk_indices_continuous(self):
        pages = [
            {"page_number": 1, "text": "First page content."},
            {"page_number": 2, "text": "Second page content."},
        ]
        chunks = chunk_pages(pages)

        indices = [c["chunk_index"] for c in chunks]
        assert indices == list(range(len(chunks)))

    def test_custom_max_tokens(self):
        text = "word " * 100  # ~100 tokens
        pages = [{"page_number": 1, "text": text}]

        # With max_tokens=50, should produce multiple chunks
        chunks = chunk_pages(pages, max_tokens=50, overlap_tokens=10)
        assert len(chunks) > 1
