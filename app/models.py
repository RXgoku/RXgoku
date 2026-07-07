"""Pydantic models shared across the pipeline."""
from __future__ import annotations

from pydantic import BaseModel, Field


class Lead(BaseModel):
    """The inbound webhook payload: a person and the company they belong to."""

    name: str = Field(..., description="The lead's full name.")
    company: str = Field(..., description="The company the lead works at.")


class LeadInsight(BaseModel):
    """Structured output the LLM returns for an enriched lead.

    Field names and shape are fixed by the JSON schema handed to the model.
    """

    pain_point: str = Field(
        ...,
        description="The single most likely business pain point this lead's "
        "company is facing that our offering could address.",
    )
    personalized_opener: str = Field(
        ...,
        description="A one- or two-sentence, specific cold-outreach opener that "
        "references the enrichment context. No generic filler.",
    )
    confidence_score: float = Field(
        ...,
        description="Confidence from 0.0 to 1.0 that the pain_point and opener are "
        "accurate and well-grounded in the enrichment context. Use the low end "
        "when the context was thin or ambiguous.",
    )


class ProcessedLead(BaseModel):
    """A lead after enrichment + scoring, ready to be written to the sheet."""

    name: str
    company: str
    pain_point: str
    personalized_opener: str
    confidence_score: float
    flagged: bool
