from google import genai
from google.genai import types

from app.core.config import settings


client = genai.Client(api_key=settings.gemini_api_key)


def create_embedding(text: str, task_type: str = "RETRIEVAL_DOCUMENT") -> list[float]:
    """
    Create a 768-dimension Gemini embedding.

    task_type:
    - RETRIEVAL_DOCUMENT for document chunks
    - RETRIEVAL_QUERY for user questions
    """
    response = client.models.embed_content(
        model="gemini-embedding-001",
        contents=text,
        config=types.EmbedContentConfig(
            task_type=task_type,
            output_dimensionality=768,
        ),
    )

    return response.embeddings[0].values


def create_embeddings_batch(
    texts: list[str],
    task_type: str = "RETRIEVAL_DOCUMENT",
    batch_size: int = 100,
) -> list[list[float]]:
    """
    Create embeddings for multiple texts in batches.

    Gemini's embed_content accepts a list of contents, so we send
    up to `batch_size` texts per API call to reduce total request count.
    """
    all_embeddings: list[list[float]] = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]

        response = client.models.embed_content(
            model="gemini-embedding-001",
            contents=batch,
            config=types.EmbedContentConfig(
                task_type=task_type,
                output_dimensionality=768,
            ),
        )

        for embedding in response.embeddings:
            all_embeddings.append(embedding.values)

    return all_embeddings