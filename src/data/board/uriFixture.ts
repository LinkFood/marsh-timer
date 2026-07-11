/**
 * uriFixture.ts — a SYNTHETIC dev-only stand-in for /board/uri-2021.json.
 *
 * NOT real data. It exercises every dot kind, a null-pct (no-data) day, earned
 * strings that tighten toward the bloom, the bloom itself, and the beat track,
 * so THE BOARD's rendering can be perfected before the baked archive film
 * lands. At runtime the real file replaces it (BoardPage fetches the JSON and
 * only falls back to this in dev). Never write this to public/board/.
 *
 * Coordinates are in the board's Albers-USA 975x610 projection space, matching
 * src/data/board/conusBorders.ts. Values are illustrative, not archival.
 */

import type { BoardFilm } from "@/lib/boardPlayer";

const WINDOW_START = "2021-01-15";

// 34-day axis, Jan 15 → Feb 17, one keyframe per day.
function axis(): string[] {
  const out: string[] = [];
  const d = new Date(`${WINDOW_START}T00:00:00Z`);
  for (let i = 0; i < 34; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// A smooth ramp 0→peak that crests near `crestDay` and holds.
function ramp(days: string[], base: number, peak: number, crestDay: number) {
  const series: Record<string, { v: number; pct: number }> = {};
  days.forEach((iso, i) => {
    const f = Math.min(1, Math.max(0, i / crestDay));
    const eased = f * f * (3 - 2 * f);
    series[iso] = {
      v: 0, // overwritten by caller
      pct: base + (peak - base) * eased,
    };
  });
  return series;
}

export function makeUriFixture(): BoardFilm {
  const days = axis();
  const crest = 30; // Feb 14-ish, the day before the bloom

  // AO needle — the pole's grip tightening, top-center (the sky).
  const ao = ramp(days, 0.28, 0.96, crest);
  days.forEach((iso, i) => (ao[iso].v = -0.4 - 2.6 * (ao[iso].pct)));

  // Texas surface temp — the deep cold, cresting at the bloom.
  const tx = ramp(days, 0.2, 0.99, crest);
  days.forEach((iso) => (tx[iso].v = 60 - 57 * tx[iso].pct)); // 60°F → ~3°F

  // Oklahoma — joins a beat behind Texas.
  const ok = ramp(days, 0.18, 0.94, crest + 1);
  days.forEach((iso) => (ok[iso].v = 58 - 52 * ok[iso].pct));

  // Louisiana — shallower, one no-data day to exercise the dim path.
  const la = ramp(days, 0.15, 0.82, crest + 2);
  days.forEach((iso) => (la[iso].v = 62 - 48 * la[iso].pct));
  la[days[9]] = { v: null as unknown as number, pct: null as unknown as number }; // instrument gap

  // Gulf buoy pressure — a hard drop as the front slams down.
  const buoy = ramp(days, 0.1, 0.9, crest);
  days.forEach((iso) => (buoy[iso].v = 1024 - 44 * buoy[iso].pct)); // 1024 → ~980 mb

  // Texas coast tide setdown — the offshore wind pushing water out.
  const tide = ramp(days, 0.12, 0.86, crest + 1);
  days.forEach((iso) => (tide[iso].v = 0.2 + 3.4 * tide[iso].pct)); // ft of setdown

  const film: BoardFilm = {
    story: "uri-2021",
    title: "The February",
    subtitle: "Winter Storm Uri, as the instruments saw it coming",
    window: [days[0], days[days.length - 1]],
    projection: { width: 975, height: 610 },
    dots: [
      { id: "ao", label: "Arctic Oscillation", sublabel: "the pole's grip", kind: "needle", x: 487, y: 30, series: ao },
      { id: "tx", label: "Texas", sublabel: "surface temperature", kind: "state-temp", x: 430, y: 468, series: tx },
      { id: "ok", label: "Oklahoma", sublabel: "surface temperature", kind: "state-temp", x: 470, y: 388, series: ok },
      { id: "la", label: "Louisiana", sublabel: "surface temperature", kind: "state-temp", x: 560, y: 486, series: la },
      { id: "buoy", label: "Buoy 42040", sublabel: "Gulf sea-level pressure", kind: "buoy-pressure", x: 545, y: 556, series: buoy },
      { id: "tide", label: "Galveston tide", sublabel: "setdown offshore", kind: "tide-setdown", x: 495, y: 528, series: tide },
    ],
    strings: [
      {
        from: "ao", to: "tx",
        receipt: "The last 19 winters the Arctic Oscillation fell below −2.4, a Southern cold outbreak followed within three weeks — including February 2011 and February 2021.",
        activation: ramp2(days, 0.0, 1.0, crest),
      },
      {
        from: "ao", to: "ok",
        receipt: "Oklahoma has trailed a deep negative AO into hard freeze in the same window five of the last seven times.",
        activation: ramp2(days, 0.0, 0.97, crest + 1),
      },
      {
        from: "buoy", to: "tx",
        receipt: "A Gulf pressure crash under 985 mb has preceded a Texas coastal freeze in every recorded case since the buoy went in.",
        activation: ramp2(days, 0.0, 0.93, crest),
      },
      {
        from: "tide", to: "tx",
        receipt: "Offshore setdown of this depth has marked the leading edge of the three coldest Texas outbreaks on file.",
        activation: ramp2(days, 0.0, 0.72, crest + 1), // a near-miss: never quite etches
      },
    ],
    blooms: [
      {
        date: days[31], // Feb 15
        x: 430, y: 468,
        label: "Texas: 665 recorded events · 131 deaths · $736.8M",
        anchor: "tx",
      },
    ],
    beats: [
      { date: days[2], line: "The Arctic needle begins to fall." },
      { date: days[10], line: "Over the pole, the grip tightens." },
      { date: days[18], line: "In the Gulf, the barometer starts to drop." },
      { date: days[24], line: "The strings pull taut toward Texas." },
      { date: days[29], line: "Everything is leaning the same way now." },
      { date: days[31], line: "February 15. The ground gives way." },
      { date: days[33], line: "What was leaning is now written down." },
    ],
  };
  return film;
}

// activation ramp (0..1 only, no value)
function ramp2(days: string[], base: number, peak: number, crestDay: number) {
  const series: Record<string, number> = {};
  days.forEach((iso, i) => {
    const f = Math.min(1, Math.max(0, i / crestDay));
    const eased = f * f * (3 - 2 * f);
    series[iso] = base + (peak - base) * eased;
  });
  return series;
}
