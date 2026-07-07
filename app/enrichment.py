"""Step (a): enrich a name + company with a web search.

Uses Claude's server-side ``web_search`` tool to gather current, cited context
about the lead and their company, then returns a compact text summary that the
scoring step consumes. Keeping enrichment as its own step means it can be
swapped for a scraper or a data-provider API without touching scoring.
"""
from __future__ import annotations

import anthropic

from .config import settings
from .models import Lead

# Latest web-search tool variant (dynamic filtering). Supported on Opus 4.8/4.7/4.6
# and Sonnet 5 / 4.6 — the models this service targets.
_WEB_SEARCH_TOOL = {"type": "web_search_20260209", "name": "web_search", "max_uses": 5}

_ENRICH_PROMPT = (
    "Research the following sales lead using web search. Summarize what you find "
    "in 4-8 tight bullet points a sales rep could skim: the company's product / "
    "market, recent news or funding, apparent challenges or initiatives, and the "
    "person's role if discoverable. Prefer recent, specific facts over generic "
    "description. If little is found, say so plainly rather than speculating.\n\n"
    "Lead: {name}\nCompany: {company}"
)


def _client() -> anthropic.Anthropic:
    # A bare client resolves creds from ANTHROPIC_API_KEY or an `ant auth login`
    # profile; only pass the key explicitly when one is configured.
    if settings.anthropic_api_key:
        return anthropic.Anthropic(api_key=settings.anthropic_api_key)
    return anthropic.Anthropic()


def enrich(lead: Lead, *, client: anthropic.Anthropic | None = None) -> str:
    """Return a plain-text enrichment summary for ``lead``.

    Raises on API/transport errors so the caller can decide how to handle a
    failed enrichment (see ``pipeline.process_lead``).
    """
    client = client or _client()

    response = client.messages.create(
        model=settings.llm_model,
        max_tokens=1500,
        tools=[_WEB_SEARCH_TOOL],
        messages=[
            {
                "role": "user",
                "content": _ENRICH_PROMPT.format(name=lead.name, company=lead.company),
            }
        ],
    )

    # The server-tool loop can pause after 10 iterations; resume until it ends.
    max_continuations = 3
    while response.stop_reason == "pause_turn" and max_continuations > 0:
        response = client.messages.create(
            model=settings.llm_model,
            max_tokens=1500,
            tools=[_WEB_SEARCH_TOOL],
            messages=[
                {
                    "role": "user",
                    "content": _ENRICH_PROMPT.format(
                        name=lead.name, company=lead.company
                    ),
                },
                {"role": "assistant", "content": response.content},
            ],
        )
        max_continuations -= 1

    summary = "\n".join(
        block.text for block in response.content if block.type == "text"
    ).strip()

    return summary or "No enrichment context could be gathered from the web."
