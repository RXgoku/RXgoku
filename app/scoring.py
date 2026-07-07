"""Step (b): pass the enrichment context to the LLM for a structured verdict.

Returns a :class:`LeadInsight` with exactly three fields
(``pain_point``, ``personalized_opener``, ``confidence_score``), enforced via
structured outputs so downstream code never has to parse free text.
"""
from __future__ import annotations

import anthropic

from .config import settings
from .enrichment import _client
from .models import Lead, LeadInsight

_SYSTEM = (
    "You are an SDR research assistant. Given a sales lead and web-enrichment "
    "context about them and their company, infer the single most likely business "
    "pain point our offering could solve, write a specific personalized cold "
    "opener grounded in that context, and rate your confidence. Base everything on "
    "the provided context; do not invent facts. When the context is thin or "
    "generic, keep confidence_score low."
)

_USER = (
    "Lead: {name}\n"
    "Company: {company}\n\n"
    "Enrichment context:\n{context}"
)


def score(
    lead: Lead,
    context: str,
    *,
    client: anthropic.Anthropic | None = None,
) -> LeadInsight:
    """Score an enriched ``lead`` and return the structured insight."""
    client = client or _client()

    response = client.messages.parse(
        model=settings.llm_model,
        max_tokens=1024,
        system=_SYSTEM,
        messages=[
            {
                "role": "user",
                "content": _USER.format(
                    name=lead.name, company=lead.company, context=context
                ),
            }
        ],
        output_format=LeadInsight,
    )

    insight = response.parsed_output
    if insight is None:
        raise RuntimeError(
            f"LLM did not return a parseable insight (stop_reason="
            f"{response.stop_reason})."
        )

    # Defensive clamp: the schema can't express numeric bounds, so keep the
    # score in range regardless of what the model emits.
    insight.confidence_score = max(0.0, min(1.0, insight.confidence_score))
    return insight
