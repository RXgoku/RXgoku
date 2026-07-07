"""FastAPI webhook entrypoint.

POST a JSON body of ``{"name": ..., "company": ...}`` to ``/webhook`` and the
lead is enriched, scored, and appended to the configured Google Sheet.

Run locally with:  uvicorn app.main:app --reload
"""
from __future__ import annotations

import logging

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, status

from .config import settings
from .models import Lead, ProcessedLead
from .pipeline import process_lead

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("lead-enrichment")

app = FastAPI(title="Lead Enrichment Automation")


def _check_token(token: str | None) -> None:
    if settings.webhook_token and token != settings.webhook_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook token."
        )


def _run(lead: Lead) -> None:
    """Background task: enrich, score, and write. Logs instead of raising so a
    single bad lead never takes down the worker."""
    try:
        processed = process_lead(lead)
        logger.info(
            "Processed %s @ %s: confidence=%.2f flagged=%s",
            processed.name,
            processed.company,
            processed.confidence_score,
            processed.flagged,
        )
    except Exception:  # noqa: BLE001 - webhook worker must not crash on one lead
        logger.exception("Failed to process lead %s @ %s", lead.name, lead.company)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/webhook", status_code=status.HTTP_202_ACCEPTED)
def webhook(
    lead: Lead,
    background_tasks: BackgroundTasks,
    x_webhook_token: str | None = Header(default=None),
) -> dict[str, str]:
    """Accept a lead and process it asynchronously.

    Returns 202 immediately; enrichment + LLM scoring can take several seconds,
    which is longer than most webhook senders will wait.
    """
    _check_token(x_webhook_token)
    background_tasks.add_task(_run, lead)
    return {"status": "accepted", "name": lead.name, "company": lead.company}


@app.post("/webhook/sync", response_model=ProcessedLead)
def webhook_sync(
    lead: Lead,
    x_webhook_token: str | None = Header(default=None),
) -> ProcessedLead:
    """Synchronous variant that returns the processed lead — handy for testing."""
    _check_token(x_webhook_token)
    return process_lead(lead)
