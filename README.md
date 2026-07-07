# Lead Enrichment → LLM Scoring → Google Sheets

A small automation service. A webhook receives a **name + company**; the service:

1. **Enriches** it with a live web search (Claude's server-side `web_search` tool).
2. **Scores** it with an LLM that returns a strict JSON object with three fields —
   `pain_point`, `personalized_opener`, `confidence_score`.
3. **Writes** the row into a Google Sheet, flagging rows whose `confidence_score`
   is above a configurable threshold.

## Architecture

```
POST /webhook  ──►  enrichment.enrich   (web search  → context text)
{name, company}     scoring.score       (LLM         → LeadInsight JSON)
                    sheets.append_lead   (Google Sheet row, flagged?)
```

| Stage | File | What it does |
|-------|------|--------------|
| Webhook | `app/main.py` | FastAPI app; validates payload, returns `202`, processes in background |
| (a) Enrich | `app/enrichment.py` | Web search via Claude → plain-text summary |
| (b) Score | `app/scoring.py` | Structured-output LLM call → `pain_point`, `personalized_opener`, `confidence_score` |
| (c) Write | `app/sheets.py` | Appends a row to Google Sheets; sets the `flagged` column |
| Orchestration | `app/pipeline.py` | Ties the three stages together |
| Config | `app/config.py` | Env-driven settings (threshold, model, sheet id, …) |

Each stage is isolated: enrichment can be swapped for a scraper, scoring for a
different schema, or the sink for a database, without touching the others.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env        # fill in the values
```

You need:

- **Anthropic access** — set `ANTHROPIC_API_KEY`, or use an `ant auth login` profile.
- **A Google service account** with edit access to your sheet. Download its JSON
  key, point `GOOGLE_SERVICE_ACCOUNT_FILE` at it, and set `GOOGLE_SHEET_ID`
  (the id in the sheet URL) and `GOOGLE_WORKSHEET_NAME`. Share the sheet with the
  service account's email.

Key settings (see `.env.example`):

| Var | Meaning |
|-----|---------|
| `LLM_MODEL` | Model for enrichment + scoring (default `claude-opus-4-8`) |
| `CONFIDENCE_THRESHOLD` | Rows with `confidence_score` **strictly above** this are flagged (default `0.7`) |
| `WEBHOOK_TOKEN` | If set, callers must send it in the `X-Webhook-Token` header |

## Run

```bash
uvicorn app.main:app --reload
```

Send a lead:

```bash
curl -X POST http://localhost:8000/webhook \
  -H "Content-Type: application/json" \
  -d '{"name": "Ada Lovelace", "company": "Analytical Engines Inc"}'
```

- `POST /webhook` → returns `202` immediately, processes in the background.
- `POST /webhook/sync` → runs synchronously and returns the processed lead
  (`pain_point`, `personalized_opener`, `confidence_score`, `flagged`) — useful
  for testing.
- `GET /health` → liveness check.

## Tests

External calls (Anthropic, Google Sheets) are stubbed, so the suite runs with no
credentials and no network:

```bash
pip install pytest
pytest
```
