import os


os.environ.setdefault("VERIFIDOCS_TESTING", "1")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("GEMINI_API_KEY", "test-gemini-api-key")
os.environ.setdefault("API_KEY", "test-demo-api-key")
os.environ.setdefault("CORS_ALLOWED_ORIGINS", "http://localhost:5173")
