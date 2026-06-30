# Feature: ai-accuracy-testing, Property 2: Reference answer prompt grounding
"""
Property-based tests for the AI accuracy evaluator module.

Property 2: Reference answer prompt grounding
- For any question string and any list of source evidence chunks, the constructed
  reference answer prompt SHALL contain only the question and the content from the
  source evidence chunks, with explicit instructions forbidding external knowledge.

Validates: Requirements 2.1, 2.4
"""

from hypothesis import given, settings, assume
from hypothesis import strategies as st

from app.rag.accuracy_evaluator import build_reference_answer_prompt


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
