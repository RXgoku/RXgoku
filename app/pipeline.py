"""Orchestrates the three steps: enrich -> score -> write.

Kept free of any web-framework concerns so it can be driven from the webhook,
a batch script, or a test.
"""
from __future__ import annotations

from . import enrichment, scoring, sheets
from .config import settings
from .models import Lead, ProcessedLead


def process_lead(lead: Lead, *, write: bool = True) -> ProcessedLead:
    """Run the full pipeline for one lead and (optionally) write it to the sheet."""
    context = enrichment.enrich(lead)
    insight = scoring.score(lead, context)

    processed = ProcessedLead(
        name=lead.name,
        company=lead.company,
        pain_point=insight.pain_point,
        personalized_opener=insight.personalized_opener,
        confidence_score=insight.confidence_score,
        flagged=insight.confidence_score > settings.confidence_threshold,
    )

    if write:
        sheets.append_lead(processed)

    return processed
