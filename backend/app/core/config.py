from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    supabase_url: str
    supabase_service_role_key: str
    gemini_api_key: str
    api_key: str
    cors_allowed_origins: str = "http://localhost:5173"

    class Config:
        env_file = ".env"

    @property
    def cors_allowed_origin_list(self) -> list[str]:
        return [
            origin.strip()
            for origin in self.cors_allowed_origins.split(",")
            if origin.strip()
        ]


settings = Settings()
