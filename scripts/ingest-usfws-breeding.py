#!/usr/bin/env python3
"""
Ingest USFWS Waterfowl Breeding Population Survey data.

Downloads annual status report PDFs from fws.gov, extracts population
estimate tables with pdfplumber, stores structured records in Supabase
with Voyage AI embeddings.

Usage:
  SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... python3 scripts/ingest-usfws-breeding.py
  SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... python3 scripts/ingest-usfws-breeding.py --dry-run
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
VOYAGE_KEY = os.environ.get("VOYAGE_API_KEY", "")

if not SERVICE_KEY:
    print("ERROR: SUPABASE_SERVICE_ROLE_KEY is required")
    sys.exit(1)

HEADERS = {
    "Authorization": f"Bearer {SERVICE_KEY}",
    "apikey": SERVICE_KEY,
    "Content-Type": "application/json",
}

PROJECT_PAGE = "https://www.fws.gov/project/waterfowl-breeding-population-and-habitat-survey"

TARGET_SPECIES = [
    "mallard", "blue-winged teal", "northern shoveler", "gadwall",
    "american wigeon", "green-winged teal", "northern pintail",
    "redhead", "canvasback", "scaup", "wood duck", "canada goose",
]

# Aliases and variations found in PDFs
SPECIES_ALIASES = {
    "bw teal": "blue-winged teal",
    "blue winged teal": "blue-winged teal",
    "gw teal": "green-winged teal",
    "green winged teal": "green-winged teal",
    "n. shoveler": "northern shoveler",
    "n. pintail": "northern pintail",
    "n shoveler": "northern shoveler",
    "n pintail": "northern pintail",
    "lesser scaup": "scaup",
    "greater scaup": "scaup",
    "total scaup": "scaup",
    "canada goose": "canada goose",
    "canadian goose": "canada goose",
}

YEAR_RANGE = range(2015, 2026)  # 2015-2025


def normalize_species(raw: str) -> Optional[str]:
    """Normalize a species name to our canonical form."""
    cleaned = raw.strip().lower()
    # Remove footnote markers
    cleaned = re.sub(r'[*†‡§¶\d]+$', '', cleaned).strip()
    # Direct match
    if cleaned in TARGET_SPECIES:
        return cleaned
    # Alias match
    if cleaned in SPECIES_ALIASES:
        return SPECIES_ALIASES[cleaned]
    # Partial match
    for sp in TARGET_SPECIES:
        if sp in cleaned or cleaned in sp:
            return sp
    return None


def parse_number(val: str) -> Optional[int]:
    """Parse a number from a table cell, handling commas and thousands notation."""
    if not val:
        return None
    cleaned = re.sub(r'[,\s]', '', val.strip())
    # Handle millions notation like "7.2" meaning 7,200,000
    # But only if the table clearly uses millions
    try:
        return int(cleaned)
    except ValueError:
        try:
            return int(float(cleaned))
        except ValueError:
            return None


def parse_trend(val: str) -> Optional[str]:
    """Parse trend from table cell."""
    if not val:
        return None
    v = val.strip().lower()
    if any(w in v for w in ["increase", "up", "+"]):
        return "up"
    if any(w in v for w in ["decrease", "down", "-", "decline"]):
        return "down"
    if any(w in v for w in ["stable", "no change", "nc", "0"]):
        return "stable"
    return None


def parse_percent(val: str) -> Optional[float]:
    """Parse percent change from table cell."""
    if not val:
        return None
    cleaned = re.sub(r'[%\s]', '', val.strip())
    try:
        return float(cleaned)
    except ValueError:
        return None


def scrape_pdf_links() -> list[dict]:
    """Scrape the USFWS project page for PDF links to annual reports."""
    print(f"Scraping {PROJECT_PAGE} for PDF links...")
    try:
        resp = requests.get(PROJECT_PAGE, timeout=30, headers={
            "User-Agent": "Mozilla/5.0 (DuckCountdown research bot)"
        })
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"  WARNING: Could not fetch project page: {e}")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    pdf_links = []

    for a in soup.find_all("a", href=True):
        href = a["href"]
        text = a.get_text(strip=True).lower()
        if ".pdf" in href.lower():
            # Try to extract year from link text or URL
            year_match = re.search(r'(20\d{2})', href + " " + text)
            if year_match:
                year = int(year_match.group(1))
                if year in YEAR_RANGE:
                    full_url = href if href.startswith("http") else f"https://www.fws.gov{href}"
                    pdf_links.append({"year": year, "url": full_url, "text": text})

    # Deduplicate by year, prefer status report
    by_year = {}
    for link in pdf_links:
        y = link["year"]
        if y not in by_year or "status" in link["text"]:
            by_year[y] = link

    found = list(by_year.values())
    print(f"  Found {len(found)} PDF links for years {sorted(by_year.keys())}")
    return found


def try_known_urls() -> list[dict]:
    """Try known URL patterns for USFWS breeding survey PDFs."""
    known_patterns = [
        "https://www.fws.gov/sites/default/files/documents/{year}-waterfowl-population-status.pdf",
        "https://www.fws.gov/sites/default/files/documents/waterfowl-population-status-{year}.pdf",
        "https://www.fws.gov/sites/default/files/documents/{year}-status-of-waterfowl.pdf",
        "https://www.fws.gov/media/waterfowl-population-status-{year}",
    ]

    results = []
    for year in YEAR_RANGE:
        for pattern in known_patterns:
            url = pattern.format(year=year)
            try:
                resp = requests.head(url, timeout=10, allow_redirects=True, headers={
                    "User-Agent": "Mozilla/5.0 (DuckCountdown research bot)"
                })
                if resp.status_code == 200:
                    content_type = resp.headers.get("Content-Type", "")
                    if "pdf" in content_type.lower() or url.endswith(".pdf"):
                        results.append({"year": year, "url": url, "text": f"{year} status report"})
                        print(f"  Found PDF for {year}: {url}")
                        break
            except requests.RequestException:
                continue
    return results


def download_pdf(url: str, year: int) -> Optional[str]:
    """Download a PDF to a temp file, return the path."""
    print(f"  Downloading {year} PDF from {url}...")
    try:
        resp = requests.get(url, timeout=60, headers={
            "User-Agent": "Mozilla/5.0 (DuckCountdown research bot)"
        })
        resp.raise_for_status()
        if len(resp.content) < 1000:
            print(f"    WARNING: PDF too small ({len(resp.content)} bytes), skipping")
            return None
        path = os.path.join(tempfile.gettempdir(), f"usfws_breeding_{year}.pdf")
        with open(path, "wb") as f:
            f.write(resp.content)
        print(f"    Downloaded {len(resp.content):,} bytes")
        return path
    except requests.RequestException as e:
        print(f"    WARNING: Download failed: {e}")
        return None


def extract_breeding_data(pdf_path: str, year: int) -> list[dict]:
    """Extract breeding population data from a PDF."""
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
            if not table or len(table) < 2:
                continue

            # Try to identify population estimate tables
            header = [str(c).lower().strip() if c else "" for c in table[0]]

            # Look for species column and estimate/population column
            species_col = None
            estimate_col = None
            se_col = None
            trend_col = None
            change_col = None

            for i, h in enumerate(header):
                if any(w in h for w in ["species", "specie"]):
                    species_col = i
                if any(w in h for w in ["estimate", "population", "total", "n̂", "nhat"]):
                    estimate_col = i
                if any(w in h for w in ["se", "standard error", "s.e."]):
                    se_col = i
                if any(w in h for w in ["trend", "direction"]):
                    trend_col = i
                if any(w in h for w in ["% change", "change", "percent"]):
                    change_col = i

            if species_col is None or estimate_col is None:
                # Try: first column is species, second is estimate
                # Check if first column has species names
                has_species = False
                for row in table[1:]:
                    if row and row[0]:
                        sp = normalize_species(str(row[0]))
                        if sp:
                            has_species = True
                            break
                if has_species:
                    species_col = 0
                    estimate_col = 1
                    if len(header) > 2:
                        se_col = 2
                    if len(header) > 3:
                        trend_col = 3
                    if len(header) > 4:
                        change_col = 4
                else:
                    continue

            # Determine survey area from page text
            page_text = page.extract_text() or ""
            survey_area = "Traditional Survey Area"
            if "eastern" in page_text.lower():
                survey_area = "Eastern Survey Area"
            elif "western" in page_text.lower() and "traditional" not in page_text.lower():
                survey_area = "Western Survey Area"

            # Extract rows
            for row in table[1:]:
                if not row or not row[species_col]:
                    continue

                species = normalize_species(str(row[species_col]))
                if not species:
                    continue

                estimate = parse_number(str(row[estimate_col])) if estimate_col is not None and estimate_col < len(row) and row[estimate_col] else None
                se = parse_number(str(row[se_col])) if se_col is not None and se_col < len(row) and row[se_col] else None
                trend = parse_trend(str(row[trend_col])) if trend_col is not None and trend_col < len(row) and row[trend_col] else None
                pct = parse_percent(str(row[change_col])) if change_col is not None and change_col < len(row) and row[change_col] else None

                if estimate is None and se is None and trend is None:
                    continue

                records.append({
                    "year": year,
                    "species": species,
                    "population_estimate": estimate,
                    "standard_error": se,
                    "trend": trend,
                    "percent_change": pct,
                    "survey_area": survey_area,
                })

    pdf.close()

    # Deduplicate by species+survey_area (keep first occurrence)
    seen = set()
    deduped = []
    for r in records:
        key = (r["species"], r["survey_area"])
        if key not in seen:
            seen.add(key)
            deduped.append(r)

    print(f"    Extracted {len(deduped)} species records")
    return deduped


def extract_from_text_fallback(pdf_path: str, year: int) -> list[dict]:
    """Fallback: extract population data from raw text when tables fail."""
    records = []
    print(f"    Attempting text-based extraction for {year}...")

    try:
        pdf = pdfplumber.open(pdf_path)
    except Exception:
        return []

    full_text = ""
    for page in pdf.pages:
        text = page.extract_text()
        if text:
            full_text += text + "\n"
    pdf.close()

    # Look for patterns like "Mallard ... 7.2 million" or "mallard population estimate was 7,200,000"
    for species in TARGET_SPECIES:
        pattern = re.compile(
            rf'{species}.*?(?:estimat|populat).*?(\d[\d,]*(?:\.\d+)?)\s*(?:million|thousand)?',
            re.IGNORECASE | re.DOTALL
        )
        match = pattern.search(full_text)
        if match:
            raw_num = match.group(1).replace(",", "")
            num = float(raw_num)
            # Check if "million" follows
            context = full_text[match.start():match.end() + 20].lower()
            if "million" in context:
                num = int(num * 1_000_000)
            elif "thousand" in context:
                num = int(num * 1_000)
            else:
                num = int(num)

            records.append({
                "year": year,
                "species": species,
                "population_estimate": num,
                "standard_error": None,
                "trend": None,
                "percent_change": None,
                "survey_area": "Traditional Survey Area",
            })

    print(f"    Text fallback extracted {len(records)} records")
    return records


def upsert_breeding_records(records: list[dict], dry_run: bool) -> int:
    """Upsert records into hunt_usfws_breeding."""
    if not records:
        return 0
    if dry_run:
        for r in records:
            est = f"{r['population_estimate']:,}" if r['population_estimate'] else "N/A"
            print(f"    [DRY RUN] {r['year']} {r['species']}: {est} ({r['trend'] or 'no trend'})")
        return len(records)

    # Upsert via REST API
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/hunt_usfws_breeding",
        headers={**HEADERS, "Prefer": "resolution=merge-duplicates"},
        json=records,
        timeout=30,
    )
    if not resp.ok:
        print(f"    ERROR upserting breeding records: {resp.status_code} {resp.text}")
        return 0
    print(f"    Upserted {len(records)} breeding records")
    return len(records)


def build_knowledge_entries(records: list[dict]) -> list[dict]:
    """Build hunt_knowledge entries from breeding records."""
    entries = []
    for r in records:
        est_str = f"{r['population_estimate']:,}" if r['population_estimate'] else "unknown"
        se_str = f" (+/-{r['standard_error']:,})" if r['standard_error'] else ""
        trend_str = f", {r['trend']}" if r['trend'] else ""
        pct_str = f" {r['percent_change']}% from previous year" if r['percent_change'] is not None else ""

        species_title = r['species'].replace('-', ' ').title()
        title = f"USFWS {r['year']} {species_title} Breeding Population Estimate"
        content = (
            f"The {r['year']} {species_title.lower()} breeding population was estimated at "
            f"{est_str} birds{se_str}{trend_str}{pct_str}, "
            f"in the {r['survey_area']}."
        )

        # Embedding text
        trend_tag = r['trend'] or 'unknown'
        pct_tag = f"{r['percent_change']}%" if r['percent_change'] is not None else 'N/A'
        rich_text = (
            f"usfws_breeding | {r['year']} | {species_title} | "
            f"population:{est_str} trend:{trend_tag} change:{pct_tag}"
        )

        entries.append({
            "title": title,
            "content": content,
            "content_type": "usfws_breeding",
            "tags": ["usfws", "breeding", r['species']],
            "metadata": {"source": "usfws_breeding_survey", "year": r['year']},
            "rich_text": rich_text,
        })
    return entries


def batch_embed(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts via Voyage AI. Max 20 at a time."""
    if not VOYAGE_KEY:
        print("    WARNING: No VOYAGE_API_KEY, skipping embeddings")
        return [[] for _ in texts]

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
                timeout=30,
            )
            if resp.ok:
                data = resp.json()
                return [item["embedding"] for item in data["data"]]
            if resp.status_code == 429 and attempt < 2:
                print(f"    Rate limited, waiting 30s...")
                time.sleep(30)
                continue
            print(f"    WARNING: Voyage API error {resp.status_code}: {resp.text[:200]}")
            return [[] for _ in texts]
        except requests.RequestException as e:
            print(f"    WARNING: Voyage API request failed: {e}")
            if attempt < 2:
                time.sleep(5)
                continue
            return [[] for _ in texts]
    return [[] for _ in texts]


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
            time.sleep(1)  # Be gentle with Voyage API

    print(f"    Upserted {total} knowledge entries")
    return total


def main():
    parser = argparse.ArgumentParser(description="Ingest USFWS Breeding Population Survey data")
    parser.add_argument("--dry-run", action="store_true", help="Parse and print without writing to DB")
    args = parser.parse_args()

    print("=== USFWS Breeding Population Survey Ingestion ===")
    print(f"  Target years: {min(YEAR_RANGE)}-{max(YEAR_RANGE)}")
    print(f"  Target species: {len(TARGET_SPECIES)}")
    print(f"  Dry run: {args.dry_run}")
    print()

    # Step 1: Find PDF links
    pdf_links = scrape_pdf_links()
    if not pdf_links:
        print("  No links from scraping, trying known URL patterns...")
        pdf_links = try_known_urls()

    if not pdf_links:
        print("  WARNING: No PDFs found. Check if USFWS has changed their site structure.")
        print("  You may need to manually download PDFs and place them in /tmp/usfws_breeding_YYYY.pdf")
        # Check for manually placed PDFs
        for year in YEAR_RANGE:
            path = os.path.join(tempfile.gettempdir(), f"usfws_breeding_{year}.pdf")
            if os.path.exists(path):
                pdf_links.append({"year": year, "url": "local", "text": "manual"})
        if not pdf_links:
            print("  No manual PDFs found either. Exiting.")
            sys.exit(0)

    # Step 2: Download and parse each PDF
    total_breeding = 0
    total_knowledge = 0
    all_records = []

    for link in sorted(pdf_links, key=lambda x: x["year"]):
        year = link["year"]
        print(f"\n--- Year {year} ---")

        # Download (skip if already exists locally)
        local_path = os.path.join(tempfile.gettempdir(), f"usfws_breeding_{year}.pdf")
        if not os.path.exists(local_path) and link["url"] != "local":
            local_path = download_pdf(link["url"], year)
            if not local_path:
                continue

        # Parse tables
        records = extract_breeding_data(local_path, year)
        if not records:
            records = extract_from_text_fallback(local_path, year)

        if not records:
            print(f"    WARNING: No data extracted for {year}")
            continue

        all_records.extend(records)

        # Upsert breeding records
        count = upsert_breeding_records(records, args.dry_run)
        total_breeding += count

        # Build and upsert knowledge entries
        knowledge = build_knowledge_entries(records)
        k_count = upsert_knowledge(knowledge, args.dry_run)
        total_knowledge += k_count

    # Summary
    print(f"\n=== Summary ===")
    print(f"  Total breeding records: {total_breeding}")
    print(f"  Total knowledge entries: {total_knowledge}")
    print(f"  Years processed: {len(set(r['year'] for r in all_records))}")
    print(f"  Species found: {sorted(set(r['species'] for r in all_records))}")


if __name__ == "__main__":
    main()
