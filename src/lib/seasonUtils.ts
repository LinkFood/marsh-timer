import { DuckSeason } from "@/data/seasonData";

export type SeasonStatus = "open" | "soon" | "upcoming" | "closed";

export function getSeasonStatus(season: DuckSeason, now: Date = new Date()): SeasonStatus {
  const open = new Date(season.seasonOpen + "T00:00:00");
  const close = new Date(season.seasonClose + "T23:59:59");
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (today >= open && now <= close) return "open";

  const daysUntilOpen = Math.ceil((open.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (daysUntilOpen > 0 && daysUntilOpen <= 30) return "soon";
  if (daysUntilOpen > 30 && daysUntilOpen <= 90) return "upcoming";

  return "closed";
}

export function getCountdownTarget(season: DuckSeason, now: Date = new Date()): { target: Date; label: string } {
  const status = getSeasonStatus(season, now);
  if (status === "open") {
    return { target: new Date(season.seasonClose + "T23:59:59"), label: "Season Closes" };
  }
  return { target: new Date(season.seasonOpen + "T00:00:00"), label: "Season Opens" };
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

export function getCompactCountdown(season: DuckSeason, now: Date = new Date()): string {
  const { target } = getCountdownTarget(season, now);
  const { days, hours } = getTimeRemaining(target, now);
  const status = getSeasonStatus(season, now);
  if (status === "open") return `Closes in ${days}d ${hours}h`;
  if (days === 0) return `Opens in ${hours}h`;
  return `${days}d ${hours}h`;
}

export function sortByNextEvent(seasons: DuckSeason[], now: Date = new Date()): DuckSeason[] {
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
