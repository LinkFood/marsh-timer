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

export function getCountdownTarget(season: HuntingSeason, now: Date = new Date()): { target: Date; label: string } {
  const active = findActiveRange(season.dates, now);
  if (active) {
    return { target: new Date(active.close + "T23:59:59"), label: "Season Closes" };
  }

  const next = findNextRange(season.dates, now);
  if (next) {
    return { target: new Date(next.open + "T00:00:00"), label: "Season Opens" };
  }

  // All ranges in the past — point to the last close
  const lastRange = season.dates[season.dates.length - 1];
  return { target: new Date(lastRange.close + "T23:59:59"), label: "Season Closed" };
}

export function getTimeRemaining(target: Date, now: Date = new Date()) {
  const diff = Math.max(0, target.getTime() - now.getTime());
  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / (1000 * 60)) % 60),
    seconds: Math.floor((diff / 1000) % 60),
    total: diff,
  };
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function getStatusColor(status: SeasonStatus): string {
  switch (status) {
    case "open": return "#22c55e";
    case "soon": return "#f59e0b";
    case "upcoming": return "#2d5a2d";
    case "closed": return "#1a2e1a";
  }
}

export function getStatusLabel(status: SeasonStatus): string {
  switch (status) {
    case "open": return "Open Now";
    case "soon": return "Opening Soon";
    case "upcoming": return "Upcoming";
    case "closed": return "Closed";
  }
}

export function getDateDisplay(season: HuntingSeason): string {
  if (season.dates.length === 1) {
    return `${formatDate(season.dates[0].open)} — ${formatDate(season.dates[0].close)}`;
  }
  return season.dates.map(r => `${formatDate(r.open)} — ${formatDate(r.close)}`).join(" | ");
}

export function getCompactCountdown(season: HuntingSeason, now: Date = new Date()): string {
  const { target } = getCountdownTarget(season, now);
  const { days, hours } = getTimeRemaining(target, now);
  const status = getSeasonStatus(season, now);
  if (status === "open") return `Closes in ${days}d ${hours}h`;
  if (status === "closed") return "Closed";
  if (days === 0) return `Opens in ${hours}h`;
  return `${days}d ${hours}h`;
}

export function sortByNextEvent(seasons: HuntingSeason[], now: Date = new Date()): HuntingSeason[] {
  return [...seasons].sort((a, b) => {
    const statusOrder: Record<SeasonStatus, number> = { open: 0, soon: 1, upcoming: 2, closed: 3 };
    const sa = getSeasonStatus(a, now);
    const sb = getSeasonStatus(b, now);
    if (statusOrder[sa] !== statusOrder[sb]) return statusOrder[sa] - statusOrder[sb];
    const ta = getCountdownTarget(a, now).target.getTime();
    const tb = getCountdownTarget(b, now).target.getTime();
    return ta - tb;
  });
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
