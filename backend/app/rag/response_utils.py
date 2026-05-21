def calculate_confidence(chunks: list[dict]) -> tuple[str, str]:
    if not chunks:
        return "not_found", "No relevant document chunks were retrieved."

    similarities = [
        chunk.get("similarity") or 0
        for chunk in chunks
    ]

    best_similarity = max(similarities)
    strong_sources = [
        similarity
        for similarity in similarities
        if similarity >= 0.45
    ]

    if best_similarity < 0.25:
        return "not_found", "The retrieved evidence is too weak to support an answer."

    if best_similarity >= 0.60 and len(strong_sources) >= 2:
        return "high", "The answer is supported by multiple strongly relevant sources."

    if best_similarity >= 0.40:
        return "medium", "The answer is supported by relevant evidence, but source coverage is limited."

    return "low", "The answer may be only partially supported because the retrieved evidence is weak."


def format_sources(chunks: list[dict]) -> list[dict]:
    return [
        {
            "document_id": chunk.get("document_id"),
            "chunk_index": chunk.get("chunk_index"),
            "page_number": chunk.get("page_number"),
            "similarity": round(chunk.get("similarity") or 0, 4),
            "preview": build_preview(chunk.get("content") or ""),
        }
        for chunk in chunks
    ]


def build_preview(content: str, max_length: int = 280) -> str:
    content = content.strip()
    return content if len(content) <= max_length else content[:max_length].rstrip() + "..."