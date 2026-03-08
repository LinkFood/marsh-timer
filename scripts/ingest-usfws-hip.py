#!/usr/bin/env python3
"""
Ingest USFWS Harvest Information Program (HIP) annual reports.

Downloads PDF reports from fws.gov, extracts state-level harvest tables
with pdfplumber, stores structured records in Supabase with Voyage AI embeddings.

Usage:
  SUPABASE_SERVICE_ROLE_KEY=... python3 scripts/ingest-usfws-hip.py
  SUPABASE_SERVICE_ROLE_KEY=... python3 scripts/ingest-usfws-hip.py --dry-run
"""

import argparse
import json
import os
import re
import sys
import tempfile
import time
from typing import Optional

import pdfplumber
import requests
from bs4 import BeautifulSoup

# --- Config ---

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://rvhyotvklfowklzjahdd.supabase.co")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SERVICE_KEY:
    print("ERROR: SUPABASE_SERVICE_ROLE_KEY is required")
    sys.exit(1)

HEADERS = {
    "Authorization": f"Bearer {SERVICE_KEY}",
    "apikey": SERVICE_KEY,
    "Content-Type": "application/json",
}

PROGRAM_PAGE = "https://www.fws.gov/program/migratory-bird-harvest-surveys"

YEAR_RANGE = range(2015, 2025)  # 2015-2024

# Full 50-state mapping
STATE_NAME_TO_ABBR = {
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
}

ABBR_TO_NAME = {v: k.title() for k, v in STATE_NAME_TO_ABBR.items()}

# Also allow matching on abbreviations directly
VALID_ABBRS = set(STATE_NAME_TO_ABBR.values())

SPECIES_GROUPS = ["ducks", "geese", "coots", "woodcock", "dove", "snipe", "rails",
                  "sea ducks", "brant", "mergansers", "teal"]

# Normalize species group names
SPECIES_GROUP_ALIASES = {
    "duck": "ducks",
    "goose": "geese",
    "coot": "coots",
    "mourning dove": "dove",
    "mourning doves": "dove",
    "doves": "dove",
    "common snipe": "snipe",
    "wilson's snipe": "snipe",
    "rail": "rails",
    "sea duck": "sea ducks",
    "merganser": "mergansers",
}


def normalize_state(raw: str) -> Optional[str]:
    """Normalize a state name to its abbreviation."""
    cleaned = raw.strip().lower()
    # Remove footnote markers
    cleaned = re.sub(r'[*†‡§¶\d]+$', '', cleaned).strip()
    # Direct abbreviation
    upper = cleaned.upper()
    if upper in VALID_ABBRS:
        return upper
    # Full name
    if cleaned in STATE_NAME_TO_ABBR:
        return STATE_NAME_TO_ABBR[cleaned]
    # Partial match
    for name, abbr in STATE_NAME_TO_ABBR.items():
        if name.startswith(cleaned) and len(cleaned) > 3:
            return abbr
    return None


def normalize_species_group(raw: str) -> Optional[str]:
    """Normalize a species group name."""
    cleaned = raw.strip().lower()
    cleaned = re.sub(r'[*†‡§¶\d]+$', '', cleaned).strip()
    if cleaned in SPECIES_GROUPS:
        return cleaned
    if cleaned in SPECIES_GROUP_ALIASES:
        return SPECIES_GROUP_ALIASES[cleaned]
    for sg in SPECIES_GROUPS:
        if sg in cleaned or cleaned in sg:
            return sg
    return None


def parse_number(val: str) -> Optional[int]:
    """Parse a number from a table cell."""
    if not val:
        return None
    cleaned = re.sub(r'[,\s]', '', val.strip())
    try:
        return int(cleaned)
    except ValueError:
        try:
            return int(float(cleaned))
        except ValueError:
            return None


def scrape_pdf_links() -> list[dict]:
    """Scrape the USFWS HIP page for PDF links."""
    print(f"Scraping {PROGRAM_PAGE} for PDF links...")
    try:
        resp = requests.get(PROGRAM_PAGE, timeout=30, headers={
            "User-Agent": "Mozilla/5.0 (DuckCountdown research bot)"
        })
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"  WARNING: Could not fetch program page: {e}")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    pdf_links = []

    for a in soup.find_all("a", href=True):
        href = a["href"]
        text = a.get_text(strip=True).lower()
        if ".pdf" in href.lower():
            year_match = re.search(r'(20\d{2})', href + " " + text)
            if year_match:
                year = int(year_match.group(1))
                if year in YEAR_RANGE:
                    full_url = href if href.startswith("http") else f"https://www.fws.gov{href}"
                    pdf_links.append({"year": year, "url": full_url, "text": text})

    by_year = {}
    for link in pdf_links:
        y = link["year"]
        # Prefer harvest/HIP reports
        if y not in by_year or any(w in link["text"] for w in ["harvest", "hip", "preliminary"]):
            by_year[y] = link

    found = list(by_year.values())
    print(f"  Found {len(found)} PDF links for years {sorted(by_year.keys())}")
    return found


def try_known_urls() -> list[dict]:
    """Try known URL patterns for HIP PDFs."""
    BASE = "https://www.fws.gov/sites/default/files/documents"

    # Confirmed URLs from recon — each PDF covers 2 seasons
    known_urls = {
        2021: f"{BASE}/migratory_bird_hunter_activity_harvest_report_2019-20_and_2020-21.pdf",
        2022: f"{BASE}/migratory-bird-hunting-activity-and-harvest-report-2020-to-2021-and-2021-to-2022.pdf",
        2023: f"{BASE}/migratory-bird-hunting-activity-and-harvest-report-2021-to-2022-and-2022-to-2023.pdf",
        2024: f"{BASE}/2024-08/migratory-bird-hunting-activity-and-harvest-during-2022-23-and-2023-24-hunting-seasons.pdf",
        2025: f"{BASE}/2025-09/migratory-bird-hunting-activity-and-harvest-during-2023-24-and-2024-25-hunting-seasons.pdf",
    }

    results = []
    for year, url in sorted(known_urls.items()):
        try:
            resp = requests.head(url, timeout=10, allow_redirects=True, headers={
                "User-Agent": "Mozilla/5.0 (DuckCountdown research bot)"
            })
            if resp.status_code == 200:
                results.append({"year": year, "url": url, "text": f"{year} harvest report"})
                print(f"  Found PDF for {year}: {url}")
            else:
                print(f"  {year}: HTTP {resp.status_code} for {url}")
        except requests.RequestException as e:
            print(f"  {year}: Request failed: {e}")
    return results


def download_pdf(url: str, year: int) -> Optional[str]:
    """Download a PDF to a temp file."""
    print(f"  Downloading {year} PDF from {url}...")
    try:
        resp = requests.get(url, timeout=60, headers={
            "User-Agent": "Mozilla/5.0 (DuckCountdown research bot)"
        })
        resp.raise_for_status()
        if len(resp.content) < 1000:
            print(f"    WARNING: PDF too small ({len(resp.content)} bytes), skipping")
            return None
        path = os.path.join(tempfile.gettempdir(), f"usfws_hip_{year}.pdf")
        with open(path, "wb") as f:
            f.write(resp.content)
        print(f"    Downloaded {len(resp.content):,} bytes")
        return path
    except requests.RequestException as e:
        print(f"    WARNING: Download failed: {e}")
        return None


def extract_hip_data(pdf_path: str, year: int) -> list[dict]:
    """Extract state-level harvest data from a HIP PDF."""
    records = []
    print(f"  Parsing PDF for {year}...")

    try:
        pdf = pdfplumber.open(pdf_path)
    except Exception as e:
        print(f"    WARNING: Could not open PDF: {e}")
        return []

    for page_num, page in enumerate(pdf.pages):
        tables = page.extract_tables()
        if not tables:
            continue

        for table in tables:
            if not table or len(table) < 3:
                continue

            header = [str(c).lower().strip() if c else "" for c in table[0]]

            # Identify columns
            state_col = None
            harvest_cols = {}  # species_group -> col_index
            hunters_col = None
            days_col = None

            for i, h in enumerate(header):
                if any(w in h for w in ["state", "region"]):
                    state_col = i
                if "duck" in h and "sea" not in h:
                    harvest_cols["ducks"] = i
                if any(w in h for w in ["geese", "goose"]):
                    harvest_cols["geese"] = i
                if "coot" in h:
                    harvest_cols["coots"] = i
                if "woodcock" in h:
                    harvest_cols["woodcock"] = i
                if any(w in h for w in ["dove", "mourning"]):
                    harvest_cols["dove"] = i
                if any(w in h for w in ["snipe", "wilson"]):
                    harvest_cols["snipe"] = i
                if any(w in h for w in ["rail"]):
                    harvest_cols["rails"] = i
                if any(w in h for w in ["active hunter", "hunters"]):
                    hunters_col = i
                if any(w in h for w in ["days afield", "days", "hunter-day", "hunter day"]):
                    days_col = i

            # If no state column found, try first column
            if state_col is None:
                has_states = False
                for row in table[1:]:
                    if row and row[0] and normalize_state(str(row[0])):
                        has_states = True
                        break
                if has_states:
                    state_col = 0

            if state_col is None:
                continue

            # If no species-specific harvest columns, check for generic "harvest" column
            if not harvest_cols:
                for i, h in enumerate(header):
                    if "harvest" in h:
                        # Try to determine species group from page context
                        page_text = (page.extract_text() or "").lower()
                        if "duck" in page_text:
                            harvest_cols["ducks"] = i
                        elif "goose" in page_text or "geese" in page_text:
                            harvest_cols["geese"] = i
                        else:
                            harvest_cols["ducks"] = i  # Default to ducks
                        break

            if not harvest_cols and hunters_col is None:
                continue

            # Extract rows
            for row in table[1:]:
                if not row or not row[state_col]:
                    continue

                state_abbr = normalize_state(str(row[state_col]))
                if not state_abbr:
                    continue

                hunters = parse_number(str(row[hunters_col])) if hunters_col is not None and hunters_col < len(row) and row[hunters_col] else None
                days = parse_number(str(row[days_col])) if days_col is not None and days_col < len(row) and row[days_col] else None

                for species_group, col_idx in harvest_cols.items():
                    if col_idx >= len(row) or not row[col_idx]:
                        continue
                    harvest = parse_number(str(row[col_idx]))
                    if harvest is None and hunters is None and days is None:
                        continue

                    records.append({
                        "year": year,
                        "state_abbr": state_abbr,
                        "species_group": species_group,
                        "harvest": harvest,
                        "active_hunters": hunters,
                        "days_afield": days,
                    })

                # If we have hunters/days but no harvest columns, create a generic record
                if not harvest_cols and (hunters is not None or days is not None):
                    records.append({
                        "year": year,
                        "state_abbr": state_abbr,
                        "species_group": "ducks",
                        "harvest": None,
                        "active_hunters": hunters,
                        "days_afield": days,
                    })

    pdf.close()

    # Deduplicate by state+species_group (keep first)
    seen = set()
    deduped = []
    for r in records:
        key = (r["state_abbr"], r["species_group"])
        if key not in seen:
            seen.add(key)
            deduped.append(r)

    print(f"    Extracted {len(deduped)} state/species records")
    return deduped


def extract_pages_as_knowledge(pdf_path: str, year: int, dry_run: bool) -> int:
    """Last-resort fallback: extract raw page text as knowledge entries for the AI brain."""
    HIP_KEYWORDS = list(STATE_NAME_TO_ABBR.keys()) + [
        "harvest", "hunters", "days afield", "active hunters",
        "ducks", "geese", "coots", "woodcock", "dove", "snipe",
        "mallard", "pintail", "teal", "gadwall", "wigeon",
    ]

    print(f"    Attempting page-level knowledge extraction for {year}...")

    try:
        pdf = pdfplumber.open(pdf_path)
    except Exception as e:
        print(f"    WARNING: Could not open PDF: {e}")
        return 0

    total = 0
    for page_num, page in enumerate(pdf.pages):
        text = page.extract_text()
        if not text or len(text.strip()) < 100:
            continue

        text_lower = text.lower()
        # Check if page has harvest-relevant content
        matches = [kw for kw in HIP_KEYWORDS if kw in text_lower]
        if len(matches) < 2:
            continue

        # Build knowledge entry
        title = f"USFWS HIP {year} Harvest Report — Page {page_num + 1}"
        content = text[:2000]
        tags = ["usfws", "hip", "harvest", "raw-text"]
        rich_text = f"usfws_hip | {year} | harvest information program | {' '.join(matches[:5])} | {content[:500]}"

        if dry_run:
            print(f"    [DRY RUN] Page knowledge: {title} ({len(matches)} keyword matches)")
            total += 1
            continue

        embedding = embed_via_edge_function(rich_text)

        row = {
            "title": title,
            "content": content,
            "content_type": "usfws_hip",
            "tags": tags,
            "metadata": json.dumps({"source": "usfws_hip", "year": year, "page": page_num + 1}),
        }
        if embedding:
            row["embedding"] = json.dumps(embedding)

        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/hunt_knowledge",
            headers={**HEADERS, "Prefer": "resolution=merge-duplicates"},
            json=[row],
            timeout=30,
        )
        if resp.ok:
            total += 1
        else:
            print(f"    ERROR inserting page knowledge: {resp.status_code} {resp.text[:200]}")

        time.sleep(0.3)  # gentle rate limit

    pdf.close()
    print(f"    Extracted {total} page-level knowledge entries")
    return total


def upsert_hip_records(records: list[dict], dry_run: bool) -> int:
    """Upsert records into hunt_usfws_hip."""
    if not records:
        return 0
    if dry_run:
        for r in records:
            harvest_str = f"{r['harvest']:,}" if r['harvest'] else "N/A"
            print(f"    [DRY RUN] {r['year']} {r['state_abbr']} {r['species_group']}: harvest={harvest_str}")
        return len(records)

    # Batch in groups of 50 for REST API
    total = 0
    batch_size = 50
    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/hunt_usfws_hip",
            headers={**HEADERS, "Prefer": "resolution=merge-duplicates"},
            json=batch,
            timeout=30,
        )
        if not resp.ok:
            print(f"    ERROR upserting HIP records: {resp.status_code} {resp.text[:200]}")
        else:
            total += len(batch)

    print(f"    Upserted {total} HIP records")
    return total


def build_knowledge_entries(records: list[dict]) -> list[dict]:
    """Build hunt_knowledge entries from HIP records."""
    entries = []
    for r in records:
        state_name = ABBR_TO_NAME.get(r["state_abbr"], r["state_abbr"])
        species = r["species_group"].title()

        harvest_str = f"{r['harvest']:,}" if r['harvest'] else "unknown"
        hunters_str = f"{r['active_hunters']:,}" if r['active_hunters'] else "unknown"
        days_str = f"{r['days_afield']:,}" if r['days_afield'] else "unknown"

        title = f"USFWS HIP {r['year']} {state_name} {species} Harvest"
        content = (
            f"{state_name} {species.lower()} harvest in {r['year']}: "
            f"{harvest_str} {r['species_group']} by {hunters_str} active hunters "
            f"over {days_str} days afield."
        )

        rich_text = (
            f"usfws_hip | {state_name} | {r['year']} | {r['species_group']} | "
            f"harvest:{harvest_str} hunters:{hunters_str} days:{days_str}"
        )

        entries.append({
            "title": title,
            "content": content,
            "content_type": "usfws_hip",
            "tags": ["usfws", "hip", state_name.lower(), r["species_group"]],
            "state_abbr": r["state_abbr"],
            "metadata": {"source": "usfws_hip", "year": r["year"]},
            "rich_text": rich_text,
        })
    return entries


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
            print(f"    WARNING: Embed error {resp.status_code}: {resp.text[:200]}")
            return []
        except requests.RequestException as e:
            if attempt < retries - 1:
                time.sleep(5)
                continue
            print(f"    WARNING: Embed request failed: {e}")
            return []
    return []


def batch_embed(texts: list[str]) -> list[list[float]]:
    """Embed texts one at a time via the edge function."""
    results = []
    for text in texts:
        emb = embed_via_edge_function(text)
        results.append(emb)
        time.sleep(0.2)  # gentle rate limit
    return results


def upsert_knowledge(entries: list[dict], dry_run: bool) -> int:
    """Upsert knowledge entries with embeddings into hunt_knowledge."""
    if not entries:
        return 0

    total = 0
    batch_size = 20

    for i in range(0, len(entries), batch_size):
        batch = entries[i:i + batch_size]

        if dry_run:
            for e in batch:
                print(f"    [DRY RUN] Knowledge: {e['title']}")
            total += len(batch)
            continue

        # Embed
        texts = [e["rich_text"] for e in batch]
        embeddings = batch_embed(texts)

        # Build rows
        rows = []
        for e, emb in zip(batch, embeddings):
            row = {
                "title": e["title"],
                "content": e["content"],
                "content_type": e["content_type"],
                "tags": e["tags"],
                "state_abbr": e.get("state_abbr"),
                "metadata": e["metadata"],
            }
            if emb:
                row["embedding"] = json.dumps(emb)
            rows.append(row)

        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/hunt_knowledge",
            headers={**HEADERS, "Prefer": "resolution=merge-duplicates"},
            json=rows,
            timeout=30,
        )
        if not resp.ok:
            print(f"    ERROR upserting knowledge: {resp.status_code} {resp.text[:200]}")
        else:
            total += len(rows)

        if i + batch_size < len(entries):
            time.sleep(1)  # Be gentle between batches

    print(f"    Upserted {total} knowledge entries")
    return total


def main():
    parser = argparse.ArgumentParser(description="Ingest USFWS HIP harvest data")
    parser.add_argument("--dry-run", action="store_true", help="Parse and print without writing to DB")
    args = parser.parse_args()

    print("=== USFWS Harvest Information Program (HIP) Ingestion ===")
    print(f"  Target years: {min(YEAR_RANGE)}-{max(YEAR_RANGE)}")
    print(f"  Dry run: {args.dry_run}")
    print()

    # Step 1: Find PDF links
    pdf_links = scrape_pdf_links()
    if not pdf_links:
        print("  No links from scraping, trying known URL patterns...")
        pdf_links = try_known_urls()

    if not pdf_links:
        print("  WARNING: No PDFs found. Check if USFWS has changed their site structure.")
        print("  You may need to manually download PDFs and place them in /tmp/usfws_hip_YYYY.pdf")
        for year in YEAR_RANGE:
            path = os.path.join(tempfile.gettempdir(), f"usfws_hip_{year}.pdf")
            if os.path.exists(path):
                pdf_links.append({"year": year, "url": "local", "text": "manual"})
        if not pdf_links:
            print("  No manual PDFs found either. Exiting.")
            sys.exit(0)

    # Step 2: Download and parse each PDF
    total_hip = 0
    total_knowledge = 0
    all_records = []

    for link in sorted(pdf_links, key=lambda x: x["year"]):
        year = link["year"]
        print(f"\n--- Year {year} ---")

        # Download (skip if already exists locally)
        local_path = os.path.join(tempfile.gettempdir(), f"usfws_hip_{year}.pdf")
        if not os.path.exists(local_path) and link["url"] != "local":
            local_path = download_pdf(link["url"], year)
            if not local_path:
                continue

        # Parse tables
        records = extract_hip_data(local_path, year)

        if not records:
            print(f"    WARNING: No structured data extracted for {year}, falling back to page-level knowledge extraction")
            page_count = extract_pages_as_knowledge(local_path, year, args.dry_run)
            total_knowledge += page_count
            continue

        all_records.extend(records)

        # Upsert HIP records
        count = upsert_hip_records(records, args.dry_run)
        total_hip += count

        # Build and upsert knowledge entries
        knowledge = build_knowledge_entries(records)
        k_count = upsert_knowledge(knowledge, args.dry_run)
        total_knowledge += k_count

    # Summary
    print(f"\n=== Summary ===")
    print(f"  Total HIP records: {total_hip}")
    print(f"  Total knowledge entries: {total_knowledge}")
    print(f"  Years processed: {len(set(r['year'] for r in all_records))}")
    print(f"  States found: {sorted(set(r['state_abbr'] for r in all_records))}")
    print(f"  Species groups: {sorted(set(r['species_group'] for r in all_records))}")


if __name__ == "__main__":
    main()
