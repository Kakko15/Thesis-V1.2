from pydantic_settings import BaseSettings
 
class Settings(BaseSettings):
    gemini_api_key: str
    supabase_url: str
    supabase_key: str
    admin_secret: str = 'admin123'
 
    class Config:
        env_file = '.env'
 
settings = Settings()
