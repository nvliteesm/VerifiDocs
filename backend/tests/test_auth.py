"""
Tests for API key authentication dependency.
"""

import pytest
from fastapi import HTTPException

from app.api.dependencies import verify_api_key
from app.core.config import settings


class TestVerifyApiKey:
    @pytest.mark.asyncio
    async def test_valid_key_passes(self):
        # Should not raise
        await verify_api_key(x_api_key=settings.api_key)

    @pytest.mark.asyncio
    async def test_missing_key_raises_401(self):
        with pytest.raises(HTTPException) as exc_info:
            await verify_api_key(x_api_key=None)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_empty_key_raises_401(self):
        with pytest.raises(HTTPException) as exc_info:
            await verify_api_key(x_api_key="")
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_wrong_key_raises_401(self):
        with pytest.raises(HTTPException) as exc_info:
            await verify_api_key(x_api_key="wrong-key-12345")
        assert exc_info.value.status_code == 401
