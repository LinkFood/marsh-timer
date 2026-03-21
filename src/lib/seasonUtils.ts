import type { HuntingSeason, DateRange } from "@/data/types";

export type SeasonStatus = "open" | "soon" | "upcoming" | "closed";

function findActiveRange(dates: DateRange[], now: Date): DateRange | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const range of dates) {
    const open = new Date(range.open + "T00:00:00");
    const close = new Date(range.close + "T23:59:59");
    if (today >= open && now <= close) return range;
  }
  return null;
}

function findNextRange(dates: DateRange[], now: Date): DateRange | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let nearest: DateRange | null = null;
  let nearestDiff = Infinity;
  for (const range of dates) {
    const open = new Date(range.open + "T00:00:00");
    const diff = open.getTime() - today.getTime();
    if (diff > 0 && diff < nearestDiff) {
      nearest = range;
      nearestDiff = diff;
    }
  }
  return nearest;
}

export function getSeasonStatus(season: HuntingSeason, now: Date = new Date()): SeasonStatus {
  const active = findActiveRange(season.dates, now);
  if (active) return "open";

  const next = findNextRange(season.dates, now);
  if (!next) return "closed";

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const open = new Date(next.open + "T00:00:00");
  const daysUntilOpen = Math.ceil((open.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilOpen <= 30) return "soon";
  if (daysUntilOpen <= 90) return "upcoming";
  return "closed";
}

export function getSeasonTypeLabel(seasonType: string): string {
  const labels: Record<string, string> = {
    "regular": "Regular Season",
    "early-teal": "Early Teal",
    "youth": "Youth Season",
    "light-goose-conservation": "Conservation Order",
    "archery": "Archery",
    "rifle": "Rifle",
    "muzzleloader": "Muzzleloader",
    "crossbow": "Crossbow",
    "spring": "Spring",
    "fall": "Fall",
    "special-white-wing": "White-Wing Dove",
  };
  return labels[seasonType] || seasonType;
}
