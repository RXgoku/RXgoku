"""Step (c): append a processed lead as a row in a Google Sheet.

The ``flagged`` column is set from ``confidence_score`` vs the threshold so a
reviewer can filter the sheet to just the high-confidence rows.
"""
from __future__ import annotations

from functools import lru_cache

import gspread
from google.oauth2.service_account import Credentials

from .config import settings
from .models import ProcessedLead

_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

HEADER = [
    "name",
    "company",
    "pain_point",
    "personalized_opener",
    "confidence_score",
    "flagged",
]


@lru_cache(maxsize=1)
def _worksheet() -> gspread.Worksheet:
    creds = Credentials.from_service_account_file(
        settings.google_service_account_file, scopes=_SCOPES
    )
    client = gspread.authorize(creds)
    sheet = client.open_by_key(settings.google_sheet_id)
    ws = sheet.worksheet(settings.google_worksheet_name)

    # Write a header row once, if the sheet is empty.
    if not ws.get_all_values():
        ws.append_row(HEADER, value_input_option="USER_ENTERED")
    return ws


def append_lead(lead: ProcessedLead, *, worksheet: gspread.Worksheet | None = None) -> None:
    """Append ``lead`` as a single row in column order matching :data:`HEADER`."""
    ws = worksheet or _worksheet()
    ws.append_row(
        [
            lead.name,
            lead.company,
            lead.pain_point,
            lead.personalized_opener,
            round(lead.confidence_score, 3),
            "TRUE" if lead.flagged else "FALSE",
        ],
        value_input_option="USER_ENTERED",
    )
