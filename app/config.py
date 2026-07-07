"""Application configuration, loaded from environment / .env."""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Anthropic
    anthropic_api_key: str | None = None
    llm_model: str = "claude-opus-4-8"

    # Scoring
    confidence_threshold: float = 0.7

    # Google Sheets
    google_service_account_file: str = "./service_account.json"
    google_sheet_id: str = ""
    google_worksheet_name: str = "Leads"

    # Webhook security
    webhook_token: str = ""


settings = Settings()
