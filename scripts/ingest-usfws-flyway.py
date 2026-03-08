#!/usr/bin/env python3
"""
USFWS Flyway Data Book backfill pipeline for DuckCountdown.

Downloads USFWS flyway data book PDFs, extracts harvest tables with pdfplumber,
stores structured records in Supabase (hunt_usfws_harvest + hunt_knowledge) with embeddings.

Usage:
  SUPABASE_SERVICE_ROLE_KEY=... python3 scripts/ingest-usfws-flyway.py

Env vars:
  SUPABASE_SERVICE_ROLE_KEY  — required
  START_FLYWAY               — resume from a specific flyway (e.g. mississippi)
  START_YEAR                 — resume from a specific year (e.g. 2020)
  --dry-run                  — pass as CLI arg to download + parse without storing

Install:
  pip install pdfplumber requests
"""

import os
import sys
import re
import json
import time
import tempfile
import logging
from typing import Optional

import pdfplumber
import requests

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://rvhyotvklfowklzjahdd.supabase.co")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
START_FLYWAY = os.environ.get("START_FLYWAY")
START_YEAR = int(os.environ.get("START_YEAR", "0"))
DRY_RUN = "--dry-run" in sys.argv

FLYWAYS = ["atlantic", "mississippi", "central", "pacific"]
YEARS = list(range(2015, 2025))  # 2015-2024

BASE_URL = "https://www.fws.gov/sites/default/files/documents"

SUPABASE_HEADERS = {
    "Authorization": f"Bearer {SERVICE_KEY}",
    "apikey": SERVICE_KEY or "",
    "Content-Type": "application/json",
}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# State name -> abbreviation mapping (50 states + DC)
# ---------------------------------------------------------------------------

STATE_TO_ABBR = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY", "district of columbia": "DC",
    # Common abbreviations/variants found in USFWS PDFs
    "n. carolina": "NC", "s. carolina": "SC", "n. dakota": "ND", "s. dakota": "SD",
    "w. virginia": "WV", "n. hampshire": "NH", "n. mexico": "NM", "r. island": "RI",
    "dist. of columbia": "DC", "d.c.": "DC",
}

ABBR_TO_NAME = {v: k.title() for k, v in STATE_TO_ABBR.items() if len(k) > 3}


def normalize_state(raw: str) -> Optional[str]:
    """Try to match a raw string to a 2-letter state abbreviation."""
    cleaned = raw.strip().lower()
    # Remove footnote markers like asterisks, digits at end
    cleaned = re.sub(r"[*0-9/]+$", "", cleaned).strip()
    # Direct match
    if cleaned in STATE_TO_ABBR:
        return STATE_TO_ABBR[cleaned]
    # Already an abbreviation?
    upper = cleaned.upper()
    if upper in ABBR_TO_NAME:
        return upper
    return None


# ---------------------------------------------------------------------------
# PDF download
# ---------------------------------------------------------------------------

def try_download_pdf(flyway: str, year: int) -> Optional[str]:
    """Try to download a USFWS flyway databook PDF. Returns temp file path or None."""
    # Try multiple URL patterns
    patterns = [
        f"{BASE_URL}/{flyway}_flyway_databook_{year}.pdf",
        f"{BASE_URL}/{flyway}_flyway_databook_{year}_2.pdf",
        f"{BASE_URL}/{flyway.capitalize()}_flyway_databook_{year}.pdf",
        f"{BASE_URL}/{flyway}_Flyway_Databook_{year}.pdf",
    ]

    for url in patterns:
        try:
            log.info(f"  Trying: {url}")
            resp = requests.get(url, timeout=60, allow_redirects=True)
            if resp.status_code == 200 and resp.headers.get("content-type", "").startswith("application/pdf"):
                tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
                tmp.write(resp.content)
                tmp.close()
                log.info(f"  Downloaded {len(resp.content)} bytes -> {tmp.name}")
                return tmp.name
            elif resp.status_code == 404:
                continue
            else:
                log.warning(f"  Unexpected status {resp.status_code} for {url}")
                continue
        except requests.RequestException as e:
            log.warning(f"  Request error for {url}: {e}")
            continue

    return None


# ---------------------------------------------------------------------------
# PDF table extraction
# ---------------------------------------------------------------------------

# Species group keywords to look for in table headers or page context
SPECIES_KEYWORDS = {
    "duck": ["duck", "ducks", "total ducks", "all ducks"],
    "goose": ["goose", "geese", "total geese", "all geese"],
    "sea_duck": ["sea duck", "sea ducks"],
    "dove": ["dove", "doves", "mourning dove"],
    "woodcock": ["woodcock"],
    "snipe": ["snipe", "wilson's snipe"],
    "coot": ["coot", "coots", "american coot"],
    "rail": ["rail", "rails", "sora"],
    "merganser": ["merganser", "mergansers"],
    "brant": ["brant"],
    "sandhill_crane": ["sandhill crane", "crane"],
    "teal": ["teal"],
}


def parse_number(val: str) -> Optional[int]:
    """Parse a number string, handling commas and special chars."""
    if not val:
        return None
    cleaned = val.strip().replace(",", "").replace(" ", "")
    # Remove footnote markers
    cleaned = re.sub(r"[*a-zA-Z/]+", "", cleaned)
    if not cleaned or cleaned in ("-", "--", ".", "...", "NA", "N/A"):
        return None
    try:
        return int(float(cleaned))
    except (ValueError, OverflowError):
        return None


def detect_species_from_context(text: str) -> str:
    """Try to detect species group from surrounding text."""
    lower = text.lower()
    for species, keywords in SPECIES_KEYWORDS.items():
        for kw in keywords:
            if kw in lower:
                return species
    return "unknown"


def is_harvest_page(text: str) -> bool:
    """Check if page text contains harvest/hunter data worth ingesting."""
    lower = text.lower()
    harvest_keywords = ["harvest", "bag", "kill", "hunter", "active hunter",
                        "days afield", "days hunted", "season total", "estimated"]
    has_keyword = any(kw in lower for kw in harvest_keywords)
    # Must also contain at least one state name or abbreviation
    has_state = any(normalize_state(word) for word in re.split(r'[\s,;]+', text) if len(word) > 1)
    if not has_state:
        # Try multi-word state names
        for state_name in STATE_TO_ABBR:
            if state_name in lower:
                has_state = True
                break
    return has_keyword and has_state


# Regex patterns for state + numbers lines in fixed-width text
# Matches lines like: "Kansas  12,345  6,789  45,678" or "KS 12345 6789"
STATE_LINE_PATTERN = re.compile(
    r'^[\s]*'
    r'(?P<state>[A-Za-z][A-Za-z\s.\']+?)'  # State name (letters, spaces, dots, apostrophes)
    r'[\s]{2,}'                              # 2+ spaces separating state from numbers
    r'(?P<numbers>[\d,.\s]+)$',             # Remaining numbers (comma-separated, space-separated)
    re.MULTILINE,
)


def parse_state_line_numbers(numbers_str: str) -> list[Optional[int]]:
    """Parse space/tab-separated numbers from a fixed-width text line."""
    # Split on 2+ spaces or tabs to separate columns
    parts = re.split(r'[\s]{2,}|\t+', numbers_str.strip())
    result = []
    for part in parts:
        val = parse_number(part)
        if val is not None:
            result.append(val)
    # If that didn't work well, try splitting on single spaces (for dense formats)
    if not result:
        parts = numbers_str.strip().split()
        for part in parts:
            val = parse_number(part)
            if val is not None:
                result.append(val)
    return result


def extract_structured_records_from_text(text: str, flyway: str, year: int, page_num: int) -> list[dict]:
    """Try to extract structured harvest records from page text using regex."""
    records = []
    species = detect_species_from_context(text)

    for match in STATE_LINE_PATTERN.finditer(text):
        state_raw = match.group("state").strip()
        numbers_raw = match.group("numbers")

        state_abbr = normalize_state(state_raw)
        if not state_abbr:
            continue

        numbers = parse_state_line_numbers(numbers_raw)
        if not numbers:
            continue

        # Assign numbers based on position — USFWS common layouts:
        # harvest, hunters, days (or subsets)
        harvest = numbers[0] if len(numbers) >= 1 else None
        hunters = numbers[1] if len(numbers) >= 2 else None
        days = numbers[2] if len(numbers) >= 3 else None

        records.append({
            "flyway": flyway,
            "year": year,
            "state_abbr": state_abbr,
            "species_group": species,
            "harvest": harvest,
            "hunters": hunters,
            "days_hunted": days,
            "_page": page_num,
            "_table": 0,
        })

    return records


def extract_harvest_data(pdf_path: str, flyway: str, year: int) -> tuple[list[dict], list[dict]]:
    """Extract harvest records + page-level knowledge entries from a USFWS flyway databook PDF.

    Returns (structured_records, page_knowledge_entries).
    """
    records = []
    page_entries = []

    try:
        pdf = pdfplumber.open(pdf_path)
    except Exception as e:
        log.error(f"  Failed to open PDF: {e}")
        return records, page_entries

    for page_num, page in enumerate(pdf.pages, 1):
        page_text = page.extract_text() or ""
        if not page_text.strip():
            continue

        # --- Prong A: Try to extract structured records from text ---
        page_records = extract_structured_records_from_text(page_text, flyway, year, page_num)
        records.extend(page_records)

        # --- Prong B: Store page-level knowledge for any harvest-related page ---
        if is_harvest_page(page_text):
            # Truncate to 2000 chars for knowledge entry
            content_text = page_text[:2000].strip()
            if content_text:
                species = detect_species_from_context(page_text)
                species_label = species.replace("_", " ").title() if species != "unknown" else "Harvest"

                page_entries.append({
                    "title": f"USFWS {flyway.title()} Flyway Databook {year} - Page {page_num}",
                    "content": content_text,
                    "content_type": "usfws_harvest",
                    "tags": ["usfws", flyway, species, f"year:{year}"],
                    "state_abbr": None,
                    "metadata": json.dumps({
                        "source": "usfws_flyway_databook",
                        "flyway": flyway,
                        "year": year,
                        "page": page_num,
                        "species_detected": species,
                        "structured_records_found": len(page_records),
                    }),
                    "_embed_text": f"USFWS {flyway} flyway {year} {species_label} | {content_text[:500]}",
                })

    total_pages = len(pdf.pages)
    pdf.close()

    if records:
        log.info(f"  Text extraction: {len(records)} structured records from {total_pages} pages")
    if page_entries:
        log.info(f"  Knowledge pages: {len(page_entries)} harvest-related pages identified")

    return records, page_entries


# ---------------------------------------------------------------------------
# Supabase storage
# ---------------------------------------------------------------------------

def upsert_harvest_records(records: list[dict]) -> int:
    """Upsert records into hunt_usfws_harvest. Returns count stored."""
    if not records:
        return 0

    # Prepare payload (strip internal fields)
    payload = []
    for r in records:
        payload.append({
            "flyway": r["flyway"],
            "year": r["year"],
            "state_abbr": r["state_abbr"],
            "species_group": r["species_group"],
            "harvest": r["harvest"],
            "hunters": r["hunters"],
            "days_hunted": r["days_hunted"],
        })

    # Upsert via REST API with on_conflict
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/hunt_usfws_harvest",
        headers={
            **SUPABASE_HEADERS,
            "Prefer": "resolution=merge-duplicates",
        },
        json=payload,
    )

    if resp.status_code in (200, 201):
        return len(payload)
    else:
        log.error(f"  Upsert failed: {resp.status_code} {resp.text[:300]}")
        return 0


def store_knowledge_records(records: list[dict], flyway: str, year: int) -> list[dict]:
    """Insert summary records into hunt_knowledge. Returns list of records with IDs for embedding."""
    if not records:
        return []

    # Group by state+species for summary records
    grouped = {}
    for r in records:
        key = (r["state_abbr"], r["species_group"])
        if key not in grouped:
            grouped[key] = r
        else:
            # Merge — take non-None values
            existing = grouped[key]
            if r["harvest"] is not None and existing["harvest"] is None:
                existing["harvest"] = r["harvest"]
            if r["hunters"] is not None and existing["hunters"] is None:
                existing["hunters"] = r["hunters"]
            if r["days_hunted"] is not None and existing["days_hunted"] is None:
                existing["days_hunted"] = r["days_hunted"]

    knowledge_rows = []
    for (state_abbr, species_group), r in grouped.items():
        state_name = ABBR_TO_NAME.get(state_abbr, state_abbr)

        parts = []
        if r["harvest"] is not None:
            parts.append(f"{r['harvest']:,} birds harvested")
        if r["hunters"] is not None:
            parts.append(f"{r['hunters']:,} active hunters")
        if r["days_hunted"] is not None:
            parts.append(f"{r['days_hunted']:,} hunter-days")

        content = f"{state_name} {species_group} harvest in {year}: {', '.join(parts)} in the {flyway} flyway." if parts else f"{state_name} {species_group} harvest data for {year} in the {flyway} flyway."

        knowledge_rows.append({
            "title": f"USFWS {flyway.title()} Flyway {year} {species_group.replace('_', ' ').title()} Harvest - {state_name}",
            "content": content,
            "content_type": "usfws_harvest",
            "tags": ["usfws", flyway, state_name.lower(), species_group],
            "state_abbr": state_abbr,
            "metadata": json.dumps({"source": "usfws_flyway_databook", "flyway": flyway, "year": year}),
            # Embed text — structured for vector search
            "_embed_text": f"usfws_harvest | {flyway} | {year} | {state_name} | {species_group} | harvest:{r['harvest']} hunters:{r['hunters']} days:{r['days_hunted']}",
        })

    # Insert into hunt_knowledge via REST
    payload = [{k: v for k, v in row.items() if not k.startswith("_")} for row in knowledge_rows]

    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/hunt_knowledge",
        headers={
            **SUPABASE_HEADERS,
            "Prefer": "return=representation",
        },
        json=payload,
    )

    if resp.status_code in (200, 201):
        inserted = resp.json()
        # Attach IDs + embed text back
        for i, row in enumerate(knowledge_rows):
            if i < len(inserted):
                row["id"] = inserted[i]["id"]
        log.info(f"  Inserted {len(inserted)} knowledge records")
        return knowledge_rows
    else:
        log.error(f"  Knowledge insert failed: {resp.status_code} {resp.text[:300]}")
        return []


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------

def embed_via_edge_function(text: str, retries=3) -> list[float]:
    """Embed a single text via the hunt-generate-embedding edge function."""
    for attempt in range(retries):
        try:
            resp = requests.post(
                f"{SUPABASE_URL}/functions/v1/hunt-generate-embedding",
                headers={
                    "Authorization": f"Bearer {SERVICE_KEY}",
                    "apikey": SERVICE_KEY,
                    "Content-Type": "application/json",
                },
                json={"text": text, "input_type": "document"},
                timeout=30,
            )
            if resp.ok:
                return resp.json()["embedding"]
            if resp.status_code == 429 and attempt < retries - 1:
                time.sleep(30)
                continue
            if resp.status_code >= 500 and attempt < retries - 1:
                time.sleep(5)
                continue
            log.warning(f"    Embed error {resp.status_code}: {resp.text[:200]}")
            return []
        except requests.RequestException as e:
            if attempt < retries - 1:
                time.sleep(5)
                continue
            log.warning(f"    Embed request failed: {e}")
            return []
    return []


def batch_embed_and_update(knowledge_rows: list[dict]):
    """Embed knowledge records one at a time via edge function and update hunt_knowledge."""
    rows_with_ids = [r for r in knowledge_rows if "id" in r]
    if not rows_with_ids:
        return

    log.info(f"  Embedding {len(rows_with_ids)} records...")

    for j, row in enumerate(rows_with_ids):
        embedding = embed_via_edge_function(row["_embed_text"])
        if embedding:
            update_resp = requests.patch(
                f"{SUPABASE_URL}/rest/v1/hunt_knowledge?id=eq.{row['id']}",
                headers=SUPABASE_HEADERS,
                json={"embedding": json.dumps(embedding)},
            )
            if update_resp.status_code not in (200, 204):
                log.warning(f"    Embedding update failed for {row['id']}: {update_resp.status_code}")
        else:
            log.warning(f"    No embedding returned for {row['id']}")
        time.sleep(0.2)  # gentle rate limit

    log.info(f"    Embedded {len(rows_with_ids)} records")


def store_page_knowledge(page_entries: list[dict]) -> list[dict]:
    """Insert page-level knowledge entries into hunt_knowledge. Returns entries with IDs for embedding."""
    if not page_entries:
        return []

    # Prepare payload (strip internal fields)
    payload = [{k: v for k, v in row.items() if not k.startswith("_")} for row in page_entries]

    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/hunt_knowledge",
        headers={
            **SUPABASE_HEADERS,
            "Prefer": "return=representation",
        },
        json=payload,
    )

    if resp.status_code in (200, 201):
        inserted = resp.json()
        for i, row in enumerate(page_entries):
            if i < len(inserted):
                row["id"] = inserted[i]["id"]
        log.info(f"  Inserted {len(inserted)} page-level knowledge entries")
        return page_entries
    else:
        log.error(f"  Page knowledge insert failed: {resp.status_code} {resp.text[:300]}")
        return []


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if not SERVICE_KEY:
        log.error("SUPABASE_SERVICE_ROLE_KEY required")
        sys.exit(1)
    if DRY_RUN:
        log.info("=== DRY RUN MODE — will download + parse only, no storage ===")

    # Apply START_FLYWAY filter
    flyways = FLYWAYS
    if START_FLYWAY:
        if START_FLYWAY in FLYWAYS:
            flyways = FLYWAYS[FLYWAYS.index(START_FLYWAY):]
            log.info(f"Starting from flyway: {START_FLYWAY}")
        else:
            log.error(f"Invalid START_FLYWAY: {START_FLYWAY}. Valid: {FLYWAYS}")
            sys.exit(1)

    total_records = 0
    total_knowledge = 0
    total_page_knowledge = 0
    total_pdfs = 0

    for flyway in flyways:
        log.info(f"\n{'='*60}")
        log.info(f"FLYWAY: {flyway.upper()}")
        log.info(f"{'='*60}")

        for year in YEARS:
            if START_YEAR and flyway == (START_FLYWAY or FLYWAYS[0]) and year < START_YEAR:
                continue

            log.info(f"\n--- {flyway.title()} {year} ---")

            # Download
            pdf_path = try_download_pdf(flyway, year)
            if not pdf_path:
                log.info(f"  No PDF found for {flyway} {year} — skipping")
                continue

            total_pdfs += 1

            # Extract (two-pronged: structured records + page knowledge)
            records = []
            page_entries = []
            try:
                records, page_entries = extract_harvest_data(pdf_path, flyway, year)
            except Exception as e:
                log.error(f"  Extraction failed: {e}")
            finally:
                # Clean up temp file
                try:
                    os.unlink(pdf_path)
                except OSError:
                    pass

            if not records and not page_entries:
                log.warning(f"  No data extracted from PDF")
                continue

            # --- Handle structured records (Prong A) ---
            if records:
                # Deduplicate by (state_abbr, species_group)
                seen = {}
                deduped = []
                for r in records:
                    key = (r["state_abbr"], r["species_group"])
                    if key not in seen:
                        seen[key] = r
                        deduped.append(r)
                    else:
                        existing = seen[key]
                        if r["harvest"] is not None and existing["harvest"] is None:
                            existing["harvest"] = r["harvest"]
                        if r["hunters"] is not None and existing["hunters"] is None:
                            existing["hunters"] = r["hunters"]
                        if r["days_hunted"] is not None and existing["days_hunted"] is None:
                            existing["days_hunted"] = r["days_hunted"]
                records = deduped

                species_groups = set(r["species_group"] for r in records)
                log.info(f"  Structured: {len(records)} records — species: {species_groups}")

                if DRY_RUN:
                    for r in records[:5]:
                        log.info(f"    {r['state_abbr']} | {r['species_group']} | harvest={r['harvest']} hunters={r['hunters']} days={r['days_hunted']}")
                    if len(records) > 5:
                        log.info(f"    ... and {len(records) - 5} more")
                    total_records += len(records)
                else:
                    stored = upsert_harvest_records(records)
                    log.info(f"  Stored {stored} harvest records")
                    total_records += stored

                    # Store structured knowledge records + embed
                    knowledge_rows = store_knowledge_records(records, flyway, year)
                    total_knowledge += len(knowledge_rows)
                    if knowledge_rows:
                        batch_embed_and_update(knowledge_rows)

            # --- Handle page-level knowledge entries (Prong B) ---
            if page_entries:
                log.info(f"  Pages: {len(page_entries)} harvest-related pages found")

                if DRY_RUN:
                    for pe in page_entries[:3]:
                        log.info(f"    {pe['title']} ({len(pe['content'])} chars)")
                    if len(page_entries) > 3:
                        log.info(f"    ... and {len(page_entries) - 3} more pages")
                    total_page_knowledge += len(page_entries)
                else:
                    stored_pages = store_page_knowledge(page_entries)
                    total_page_knowledge += len(stored_pages)
                    if stored_pages:
                        batch_embed_and_update(stored_pages)

            # Be polite to USFWS servers
            time.sleep(2)

    log.info(f"\n{'='*60}")
    log.info(f"DONE {'(DRY RUN)' if DRY_RUN else ''}")
    log.info(f"  PDFs downloaded: {total_pdfs}")
    log.info(f"  Structured harvest records: {total_records}")
    log.info(f"  Structured knowledge records: {total_knowledge}")
    log.info(f"  Page-level knowledge entries: {total_page_knowledge}")
    log.info(f"{'='*60}")


if __name__ == "__main__":
    main()
