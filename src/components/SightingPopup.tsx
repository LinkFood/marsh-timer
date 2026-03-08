const RECENCY_BADGES: Record<string, { label: string; bg: string; text: string }> = {
  today: { label: "Today", bg: "rgba(16,185,129,0.25)", text: "#10b981" },
  recent: { label: "Recent", bg: "rgba(245,158,11,0.25)", text: "#f59e0b" },
  old: { label: "Older", bg: "rgba(100,116,139,0.25)", text: "#94a3b8" },
};

export function getSightingPopupHTML(
  name: string,
  count: number,
  location: string,
  date: string,
  recency: string,
): string {
  const badge = RECENCY_BADGES[recency] || RECENCY_BADGES.old;

  const countBadge =
    count > 0
      ? `<span style="background:rgba(16,185,129,0.2);color:#10b981;font-size:11px;font-weight:600;padding:1px 6px;border-radius:8px;margin-left:6px">${count}</span>`
      : "";

  return `
    <div style="font-family:Inter,sans-serif;padding:4px 0;min-width:140px;max-width:220px">
      <div style="font-weight:600;font-size:13px;color:#fff;line-height:1.3;display:flex;align-items:center;flex-wrap:wrap">
        ${name}${countBadge}
      </div>
      <div style="color:rgba(255,255,255,0.5);font-size:11px;margin-top:4px">${location}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
        <span style="font-size:11px;color:rgba(255,255,255,0.4)">${date}</span>
        <span style="background:${badge.bg};color:${badge.text};font-size:10px;font-weight:500;padding:1px 6px;border-radius:6px">${badge.label}</span>
      </div>
    </div>
  `;
}
