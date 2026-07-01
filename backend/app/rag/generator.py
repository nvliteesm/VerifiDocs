from fastapi import HTTPException
from google import genai
from google.genai import errors

from app.core.config import settings


_client = None


def get_gemini_client():
    global _client

    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)

    return _client


def generate_answer(prompt: str) -> str:
    """
    Generate a grounded answer using Gemini.
    """
    try:
        response = get_gemini_client().models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=prompt,
        )

        return response.text

    except errors.ServerError:
        raise HTTPException(
            status_code=503,
            detail="AI is currently unavailable due to high demand. Please try again later.",
        )

    except errors.APIError as error:
        raise HTTPException(
            status_code=502,
            detail=f"Gemini API error: {str(error)}",
        )
    
def _generate_with_model(model: str, prompt: str) -> str:
    response = get_gemini_client().models.generate_content(
        model=model,
        contents=prompt,
    )

    return response.text
