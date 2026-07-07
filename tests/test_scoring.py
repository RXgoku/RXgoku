"""Tests for the scoring step, with a stubbed Anthropic client."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app import scoring
from app.models import Lead, LeadInsight


class _FakeMessages:
    def __init__(self, insight, stop_reason="end_turn"):
        self._insight = insight
        self._stop_reason = stop_reason

    def parse(self, **kwargs):
        return SimpleNamespace(parsed_output=self._insight, stop_reason=self._stop_reason)


class _FakeClient:
    def __init__(self, insight, stop_reason="end_turn"):
        self.messages = _FakeMessages(insight, stop_reason)


def test_score_returns_insight():
    insight = LeadInsight(
        pain_point="fragmented tooling",
        personalized_opener="Saw your eng team doubled...",
        confidence_score=0.65,
    )
    result = scoring.score(
        Lead(name="Ada", company="Analytical"),
        "context",
        client=_FakeClient(insight),
    )
    assert result.pain_point == "fragmented tooling"
    assert result.confidence_score == 0.65


def test_score_clamps_out_of_range_confidence():
    insight = LeadInsight(pain_point="x", personalized_opener="y", confidence_score=1.4)
    result = scoring.score(
        Lead(name="Ada", company="Analytical"),
        "context",
        client=_FakeClient(insight),
    )
    assert result.confidence_score == 1.0


def test_score_raises_when_no_parsed_output():
    with pytest.raises(RuntimeError):
        scoring.score(
            Lead(name="Ada", company="Analytical"),
            "context",
            client=_FakeClient(None, stop_reason="max_tokens"),
        )
