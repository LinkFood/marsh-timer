/**
 * fetch-sky-fixtures.ts — snapshot the deployed solunar oracle, once.
 *
 * `src/lib/sky.ts` is a port of `supabase/functions/hunt-atlas-solunar`. The
 * parity test that holds the port honest must run OFFLINE — the whole point of
 * sky.ts is that it works with the phone in airplane mode, and a test suite
 * that phones a Supabase function to prove it is a test suite that goes red on
 * a plane, in a blind, or the day that function is finally retired.
 *
 * So the oracle is called once, here, by hand, and its answers are committed as
 * a golden file. `src/lib/sky.test.ts` reads the file and never opens a socket.
 *
 *   npx tsx scripts/fetch-sky-fixtures.ts
 *
 * Re-run this ONLY when you mean to re-baseline against the deployed function.
 * If a re-run changes the file, the edge function changed, and that is news.
 *
 * WHAT THE FIXTURE KEEPS: the oracle's raw response, minus the constant `note`
 * string and minus the echoed `date`/`lat`/`lng` (already the row's key). That
 * INCLUDES `shooting_light_start`, `shooting_light_end`, `rating` and `score` —
 * the fixture is an honest record of what the function said, warts included.
 * The TEST is where those fields are refused. See the exclusion block there.
 */

import * as fs from "fs";
import * as path from "path";

const ORACLE = "https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-atlas-solunar";
const OUT = path.resolve(process.cwd(), "src/lib/__fixtures__/sky-oracle.json");

/**
 * Six spots chosen to break things, not to flatter the port:
 *
 *  blackwater — Blackwater NWR, MD. The reference marsh; the spot the product
 *               is actually built for, mid-latitude, ordinary.
 *  utqiagvik  — 71.3°N. Above the Arctic Circle: months of midnight sun and
 *               months of polar night, so `cosH` leaves [-1,1] in BOTH
 *               directions and the moon can go days without rising or setting.
 *  adak       — 51.9°N, 176.6°W. Two hours of longitude from the date line, so
 *               UTC-day framing and local day disagree hard; solar noon lands
 *               near 23:50Z and sunset routinely rolls past midnight Z.
 *  stuttgart  — Stuttgart, AR. The rice prairie, the other real hunting ground.
 *  sacramento — Sacramento Valley, CA. Pacific flyway, far western CONUS.
 *  ushuaia    — 54.8°S. Southern hemisphere: every seasonal sign flips, which
 *               catches any northern-hemisphere assumption baked into the math.
 */
const SPOTS = [
  { id: "blackwater", name: "Blackwater NWR, MD", lat: 38.4436, lng: -76.0722 },
  { id: "utqiagvik", name: "Utqiagvik, AK", lat: 71.2906, lng: -156.7887 },
  { id: "adak", name: "Adak, AK", lat: 51.88, lng: -176.6581 },
  { id: "stuttgart", name: "Stuttgart, AR", lat: 34.4995, lng: -91.5526 },
  { id: "sacramento", name: "Sacramento Valley, CA", lat: 39.0, lng: -121.9 },
  { id: "ushuaia", name: "Ushuaia, AR", lat: -54.8019, lng: -68.303 },
];

/** 2028 is a leap year — 366 dates, and Feb 29 comes along for free. */
const YEAR = 2028;

function datesOfYear(year: number): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(year, 0, 1));
  while (d.getUTCFullYear() === year) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

async function fetchOne(lat: number, lng: number, date: string, attempt = 1): Promise<unknown> {
  const res = await fetch(`${ORACLE}?lat=${lat}&lng=${lng}&date=${date}`);
  if (!res.ok) {
    // 4xx is a bad request and retrying it just repeats the mistake.
    if (res.status < 500 || attempt >= 4) {
      throw new Error(`oracle ${res.status} for ${lat},${lng} ${date}`);
    }
    await new Promise((r) => setTimeout(r, 500 * attempt));
    return fetchOne(lat, lng, date, attempt + 1);
  }
  const body = (await res.json()) as Record<string, unknown>;
  const data = (body.data ?? body) as Record<string, unknown>;
  delete data.note;
  delete data.date;
  delete data.lat;
  delete data.lng;
  return data;
}

async function main() {
  const dates = datesOfYear(YEAR);
  const rows: Record<string, Record<string, unknown>> = {};
  let done = 0;
  const total = SPOTS.length * dates.length;

  for (const spot of SPOTS) {
    rows[spot.id] = {};
    // 16 in flight: fast enough to finish in a couple of minutes, gentle enough
    // that the function's isolate never sheds a request.
    const queue = [...dates];
    const workers = Array.from({ length: 16 }, async () => {
      for (;;) {
        const date = queue.shift();
        if (!date) return;
        rows[spot.id][date] = await fetchOne(spot.lat, spot.lng, date);
        done += 1;
        if (done % 200 === 0) process.stdout.write(`  ${done}/${total}\n`);
      }
    });
    await Promise.all(workers);
    process.stdout.write(`${spot.id} done\n`);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        oracle: "supabase/functions/hunt-atlas-solunar",
        oracle_url: ORACLE,
        captured_at: new Date().toISOString(),
        year: YEAR,
        spots: SPOTS,
        dates,
        rows,
      },
      null,
      0,
    ) + "\n",
  );
  process.stdout.write(`wrote ${OUT} (${total} rows)\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
