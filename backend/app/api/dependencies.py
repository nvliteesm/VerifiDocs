from fastapi import Header, HTTPException

from app.core.config import settings


async def verify_api_key(x_api_key: str = Header(default=None)):
    """
    Validate that the request includes a valid API key in the X-API-Key header.
    """
    if not x_api_key or x_api_key != settings.api_key:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing API key.",
        )
