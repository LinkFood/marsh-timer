#!/usr/bin/env python3
"""
USFWS Flyway Data Book backfill pipeline for DuckCountdown.

Downloads USFWS flyway data book PDFs, extracts harvest tables with pdfplumber,
stores structured records in Supabase (hunt_usfws_harvest + hunt_knowledge) with embeddings.

Usage:
  SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... python3 scripts/ingest-usfws-flyway.py

Env vars:
  SUPABASE_SERVICE_ROLE_KEY  — required
  VOYAGE_API_KEY             — required
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
VOYAGE_KEY = os.environ.get("VOYAGE_API_KEY")
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


def extract_harvest_data(pdf_path: str, flyway: str, year: int) -> list[dict]:
    """Extract harvest records from a USFWS flyway databook PDF."""
    records = []

    try:
        pdf = pdfplumber.open(pdf_path)
    except Exception as e:
        log.error(f"  Failed to open PDF: {e}")
        return records

    for page_num, page in enumerate(pdf.pages, 1):
        tables = page.extract_tables()
        if not tables:
            continue

        # Get page text for species context
        page_text = page.extract_text() or ""

        for table_idx, table in enumerate(tables):
            if not table or len(table) < 2:
                continue

            # Try to find header row — look for "State" or state names
            header_row_idx = None
            state_col_idx = None
            harvest_col_idx = None
            hunters_col_idx = None
            days_col_idx = None

            # First pass: find the header
            for row_idx, row in enumerate(table):
                if not row:
                    continue
                for col_idx, cell in enumerate(row):
                    if not cell:
                        continue
                    cell_lower = cell.strip().lower()
                    if cell_lower in ("state", "states", "state/area"):
                        header_row_idx = row_idx
                        state_col_idx = col_idx
                        break
                if header_row_idx is not None:
                    break

            if header_row_idx is None:
                # Try to detect tables by looking for state names in first column
                for row_idx, row in enumerate(table):
                    if not row or not row[0]:
                        continue
                    if normalize_state(row[0]):
                        # Found a state in first column — assume no header row
                        state_col_idx = 0
                        header_row_idx = -1  # sentinel: no header
                        break

            if state_col_idx is None:
                continue

            # Identify harvest/hunters/days columns from header
            if header_row_idx >= 0 and header_row_idx < len(table):
                header = table[header_row_idx]
                for col_idx, cell in enumerate(header):
                    if not cell:
                        continue
                    cell_lower = cell.strip().lower()
                    if "harvest" in cell_lower or "bag" in cell_lower or "kill" in cell_lower:
                        harvest_col_idx = col_idx
                    elif "hunter" in cell_lower or "active" in cell_lower:
                        hunters_col_idx = col_idx
                    elif "day" in cell_lower:
                        days_col_idx = col_idx

            # If we couldn't identify columns from headers, assume common layout:
            # State | Harvest | Hunters | Days (or variations)
            num_cols = max(len(row) for row in table if row)
            if harvest_col_idx is None and num_cols >= 2:
                harvest_col_idx = state_col_idx + 1
            if hunters_col_idx is None and num_cols >= 3:
                hunters_col_idx = state_col_idx + 2
            if days_col_idx is None and num_cols >= 4:
                days_col_idx = state_col_idx + 3

            # Detect species from page context
            species = detect_species_from_context(page_text)

            # Also check for species in table header area
            if species == "unknown" and header_row_idx >= 0:
                header_text = " ".join(str(c) for c in table[header_row_idx] if c)
                species = detect_species_from_context(header_text)

            # Check rows above header for species context
            if species == "unknown":
                for check_idx in range(max(0, (header_row_idx if header_row_idx >= 0 else 0) - 3),
                                        max(0, header_row_idx if header_row_idx >= 0 else 0)):
                    if check_idx < len(table) and table[check_idx]:
                        row_text = " ".join(str(c) for c in table[check_idx] if c)
                        species = detect_species_from_context(row_text)
                        if species != "unknown":
                            break

            # Extract data rows
            start_row = (header_row_idx + 1) if header_row_idx >= 0 else 0
            for row in table[start_row:]:
                if not row or not row[state_col_idx]:
                    continue

                state_abbr = normalize_state(row[state_col_idx])
                if not state_abbr:
                    # Could be a total/summary row — skip
                    continue

                def safe_col(idx):
                    if idx is not None and idx < len(row) and row[idx]:
                        return parse_number(row[idx])
                    return None

                harvest = safe_col(harvest_col_idx)
                hunters = safe_col(hunters_col_idx)
                days = safe_col(days_col_idx)

                # Skip rows where all data is None
                if harvest is None and hunters is None and days is None:
                    continue

                records.append({
                    "flyway": flyway,
                    "year": year,
                    "state_abbr": state_abbr,
                    "species_group": species,
                    "harvest": harvest,
                    "hunters": hunters,
                    "days_hunted": days,
                    "_page": page_num,
                    "_table": table_idx,
                })

        page.close()

    pdf.close()
    return records


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
            "tags": json.dumps(["usfws", flyway, state_name.lower(), species_group]),
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

def batch_embed_and_update(knowledge_rows: list[dict]):
    """Embed knowledge records in batches of 20 and update hunt_knowledge."""
    rows_with_ids = [r for r in knowledge_rows if "id" in r]
    if not rows_with_ids:
        return

    batch_size = 20
    for i in range(0, len(rows_with_ids), batch_size):
        batch = rows_with_ids[i:i + batch_size]
        texts = [r["_embed_text"] for r in batch]

        log.info(f"  Embedding batch {i // batch_size + 1} ({len(batch)} texts)...")

        for attempt in range(3):
            try:
                resp = requests.post(
                    "https://api.voyageai.com/v1/embeddings",
                    headers={
                        "Authorization": f"Bearer {VOYAGE_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "voyage-3-lite",
                        "input": texts,
                        "input_type": "document",
                    },
                    timeout=60,
                )

                if resp.status_code == 200:
                    embeddings = [d["embedding"] for d in resp.json()["data"]]
                    # Update each record with its embedding
                    for j, row in enumerate(batch):
                        update_resp = requests.patch(
                            f"{SUPABASE_URL}/rest/v1/hunt_knowledge?id=eq.{row['id']}",
                            headers=SUPABASE_HEADERS,
                            json={"embedding": json.dumps(embeddings[j])},
                        )
                        if update_resp.status_code not in (200, 204):
                            log.warning(f"    Embedding update failed for {row['id']}: {update_resp.status_code}")
                    log.info(f"    Embedded {len(batch)} records")
                    break
                elif resp.status_code == 429 and attempt < 2:
                    wait = (attempt + 1) * 30
                    log.warning(f"    Rate limited, waiting {wait}s...")
                    time.sleep(wait)
                    continue
                elif resp.status_code >= 500 and attempt < 2:
                    wait = (attempt + 1) * 5
                    log.warning(f"    Server error {resp.status_code}, retrying in {wait}s...")
                    time.sleep(wait)
                    continue
                else:
                    log.error(f"    Voyage error: {resp.status_code} {resp.text[:200]}")
                    break
            except requests.RequestException as e:
                if attempt < 2:
                    log.warning(f"    Request error, retrying: {e}")
                    time.sleep(5)
                else:
                    log.error(f"    Embedding request failed: {e}")

        # Small delay between batches to avoid rate limits
        if i + batch_size < len(rows_with_ids):
            time.sleep(1)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if not SERVICE_KEY:
        log.error("SUPABASE_SERVICE_ROLE_KEY required")
        sys.exit(1)
    if not VOYAGE_KEY and not DRY_RUN:
        log.error("VOYAGE_API_KEY required (or use --dry-run)")
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

            # Extract
            try:
                records = extract_harvest_data(pdf_path, flyway, year)
            except Exception as e:
                log.error(f"  Extraction failed: {e}")
                records = []
            finally:
                # Clean up temp file
                try:
                    os.unlink(pdf_path)
                except OSError:
                    pass

            if not records:
                log.warning(f"  No harvest records extracted from PDF")
                continue

            # Deduplicate by (state_abbr, species_group)
            seen = {}
            deduped = []
            for r in records:
                key = (r["state_abbr"], r["species_group"])
                if key not in seen:
                    seen[key] = r
                    deduped.append(r)
                else:
                    # Merge — prefer non-None values
                    existing = seen[key]
                    if r["harvest"] is not None and existing["harvest"] is None:
                        existing["harvest"] = r["harvest"]
                    if r["hunters"] is not None and existing["hunters"] is None:
                        existing["hunters"] = r["hunters"]
                    if r["days_hunted"] is not None and existing["days_hunted"] is None:
                        existing["days_hunted"] = r["days_hunted"]
            records = deduped

            species_groups = set(r["species_group"] for r in records)
            log.info(f"  Extracted {len(records)} records — species: {species_groups}")

            if DRY_RUN:
                # Print sample
                for r in records[:5]:
                    log.info(f"    {r['state_abbr']} | {r['species_group']} | harvest={r['harvest']} hunters={r['hunters']} days={r['days_hunted']}")
                if len(records) > 5:
                    log.info(f"    ... and {len(records) - 5} more")
                total_records += len(records)
                continue

            # Store harvest records
            stored = upsert_harvest_records(records)
            log.info(f"  Stored {stored} harvest records")
            total_records += stored

            # Store knowledge records + embed
            knowledge_rows = store_knowledge_records(records, flyway, year)
            total_knowledge += len(knowledge_rows)

            if knowledge_rows:
                batch_embed_and_update(knowledge_rows)

            # Be polite to USFWS servers
            time.sleep(2)

    log.info(f"\n{'='*60}")
    log.info(f"DONE {'(DRY RUN)' if DRY_RUN else ''}")
    log.info(f"  PDFs downloaded: {total_pdfs}")
    log.info(f"  Harvest records: {total_records}")
    log.info(f"  Knowledge records: {total_knowledge}")
    log.info(f"{'='*60}")


if __name__ == "__main__":
    main()
