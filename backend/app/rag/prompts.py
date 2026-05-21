def build_grounded_prompt(question: str, chunks: list[dict]) -> str:
    """
    Build a grounded prompt using retrieved document chunks.
    """
    context_blocks = []

    for index, chunk in enumerate(chunks, start=1):
        context_blocks.append(
            f"""
Source {index}
Page: {chunk.get("page_number")}
Similarity: {chunk.get("similarity")}
Content:
{chunk.get("content")}
"""
        )

    context = "\n".join(context_blocks)

    return f"""
You are AskDocs AI, a document question-answering assistant.

Answer the user's question using only the provided document context.

Rules:
1. Use only the document context below.
2. Do not use outside knowledge.
3. Do not invent facts, assumptions, or missing details.
4. If the answer is not found in the context, say exactly: "I could not find this information in the uploaded document."
5. Keep the answer concise and easy to understand.
6. Use 2 to 5 sentences for normal answers.
7. Use bullet points only when the question asks for a summary, list, requirements, steps, or key points.
8. Do not add source labels like "(Source 1)" or "(Source 2)" inside the answer.
9. Do not mention similarity scores.
10. Do not include a confidence rating. The system calculates confidence separately.
11. You may mention page numbers naturally only when they help the user locate the information.

Document context:
{context}

User question:
{question}

Answer:
"""