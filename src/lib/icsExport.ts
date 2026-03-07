import type { HuntingSeason } from "@/data/types";
import { getSeasonTypeLabel } from "@/lib/seasonUtils";
import { speciesConfig } from "@/data/speciesConfig";

function formatICSDate(isoDate: string): string {
  return isoDate.replace(/-/g, "");
}

function uid(season: HuntingSeason, rangeIndex: number): string {
  return `${season.species}-${season.abbreviation}-${season.seasonType}-${season.zoneSlug}-${rangeIndex}@duckcountdown.com`;
}

function escapeICS(text: string): string {
  return text.replace(/[,;\\]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
}

export function generateICS(seasons: HuntingSeason[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DuckCountdown//Season Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:Duck Countdown - Hunting Seasons`,
  ];

  for (const season of seasons) {
    const label = speciesConfig[season.species]?.label || season.species;
    const typeLabel = getSeasonTypeLabel(season.seasonType);

    for (let i = 0; i < season.dates.length; i++) {
      const range = season.dates[i];
      const splitLabel = season.dates.length > 1 ? ` (Split ${i + 1})` : "";
      const summary = `${label} ${typeLabel} - ${season.state}${season.zone !== "Statewide" ? ` (${season.zone})` : ""}${splitLabel}`;

      const descParts = [
        `Bag Limit: ${season.bagLimit}`,
        season.flyway ? `Flyway: ${season.flyway}` : null,
        season.weapon ? `Weapon: ${season.weapon}` : null,
        season.notes || null,
        `duckcountdown.com/${season.species}/${season.abbreviation}`,
      ].filter(Boolean);

      // ICS all-day events: DTEND is the day AFTER the last day
      const endDate = new Date(range.close + "T00:00:00");
      endDate.setDate(endDate.getDate() + 1);
      const endStr = endDate.toISOString().slice(0, 10).replace(/-/g, "");

      lines.push(
        "BEGIN:VEVENT",
        `UID:${uid(season, i)}`,
        `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
        `DTSTART;VALUE=DATE:${formatICSDate(range.open)}`,
        `DTEND;VALUE=DATE:${endStr}`,
        `SUMMARY:${escapeICS(summary)}`,
        `DESCRIPTION:${escapeICS(descParts.join("\\n"))}`,
        `URL:https://duckcountdown.com/${season.species}/${season.abbreviation}`,
        "END:VEVENT",
      );
    }
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function downloadICS(seasons: HuntingSeason[], filename?: string) {
  const ics = generateICS(seasons);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `hunting-seasons.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
