"""Tests for the enrich -> score -> write pipeline.

All external calls (Anthropic, Google Sheets) are stubbed, so these run with no
credentials and no network.
"""
from __future__ import annotations

import app.pipeline as pipeline
from app.config import settings
from app.models import Lead, LeadInsight, ProcessedLead
from app.sheets import HEADER, append_lead


def _patch_stages(monkeypatch, *, confidence: float) -> None:
    monkeypatch.setattr(pipeline.enrichment, "enrich", lambda lead: "context blob")
    monkeypatch.setattr(
        pipeline.scoring,
        "score",
        lambda lead, context: LeadInsight(
            pain_point="slow onboarding",
            personalized_opener="Noticed you just raised a Series B...",
            confidence_score=confidence,
        ),
    )


def test_high_confidence_lead_is_flagged(monkeypatch):
    monkeypatch.setattr(settings, "confidence_threshold", 0.7)
    _patch_stages(monkeypatch, confidence=0.91)

    result = pipeline.process_lead(Lead(name="Ada Lovelace", company="Analytical"), write=False)

    assert isinstance(result, ProcessedLead)
    assert result.flagged is True
    assert result.pain_point == "slow onboarding"


def test_low_confidence_lead_is_not_flagged(monkeypatch):
    monkeypatch.setattr(settings, "confidence_threshold", 0.7)
    _patch_stages(monkeypatch, confidence=0.42)

    result = pipeline.process_lead(Lead(name="Grace Hopper", company="Navy"), write=False)

    assert result.flagged is False


def test_threshold_is_strict_greater_than(monkeypatch):
    """A score exactly equal to the threshold is NOT flagged."""
    monkeypatch.setattr(settings, "confidence_threshold", 0.7)
    _patch_stages(monkeypatch, confidence=0.7)

    result = pipeline.process_lead(Lead(name="Edge Case", company="Boundary"), write=False)

    assert result.flagged is False


def test_process_lead_writes_to_sheet(monkeypatch):
    monkeypatch.setattr(settings, "confidence_threshold", 0.7)
    _patch_stages(monkeypatch, confidence=0.8)

    written: list = []
    monkeypatch.setattr(pipeline.sheets, "append_lead", lambda p: written.append(p))

    pipeline.process_lead(Lead(name="Alan Turing", company="Bletchley"), write=True)

    assert len(written) == 1
    assert written[0].flagged is True


class _FakeWorksheet:
    def __init__(self):
        self.rows: list[list] = []

    def append_row(self, row, value_input_option=None):  # noqa: D401
        self.rows.append(row)


def test_append_lead_row_matches_header_order():
    ws = _FakeWorksheet()
    lead = ProcessedLead(
        name="Ada",
        company="Analytical",
        pain_point="slow onboarding",
        personalized_opener="Hi Ada...",
        confidence_score=0.876543,
        flagged=True,
    )

    append_lead(lead, worksheet=ws)

    assert len(ws.rows) == 1
    row = ws.rows[0]
    assert len(row) == len(HEADER)
    assert row[0] == "Ada"
    assert row[4] == 0.877  # rounded to 3 dp
    assert row[5] == "TRUE"
