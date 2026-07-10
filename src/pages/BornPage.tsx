import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TILE_GRID } from "@/components/EventMap";
import { STATE_NAMES } from "@/data/atlas/stateBBoxes";

/**
 * THE NIGHT YOU WERE BORN — the entry surface for a birthday (acceptance
 * test 4: "type a birthday + place, get wonder that is entirely real").
 *
 * A quiet full-viewport entry: pick a month + day, TYPE a year (decades back
 * without fighting a phone), pick a state. Submit falls straight into the
 * atlas dossier for that state on that exact date — `/atlas?date=YYYY-MM-DD&
 * state=XX` — so the visitor lands DESCENDED into their own ground: what the
 * sky, the tide, and the storm ledger were doing the night they were born.
 * Nothing invented — the atlas only reads back recorded fact, era notes and
 * all ("the federal storm ledger begins in 1950 — only the instruments speak").
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Only offer states the atlas can actually fall into (every TILE_GRID key),
// labeled by full name, sorted alphabetically.
const STATE_OPTIONS = Object.keys(TILE_GRID)
  .map((abbr) => ({ abbr, name: STATE_NAMES[abbr] ?? abbr }))
  .sort((a, b) => a.name.localeCompare(b.name));

const NOW = new Date();
const MAX_YEAR = NOW.getFullYear();
const MIN_YEAR = 1900;

function daysInMonth(year: number, month1: number): number {
  // month1 is 1-12; day 0 of the next month == last day of this month.
  return new Date(year, month1, 0).getDate();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export default function BornPage() {
  const navigate = useNavigate();
  const [month, setMonth] = useState<string>(""); // "1".."12"
  const [day, setDay] = useState<string>("");
  const [year, setYear] = useState<string>("");
  const [state, setState] = useState<string>("");

  const monthNum = month ? Number(month) : null;
  const yearNum = year ? Number(year) : null;

  // Valid day count for the chosen month/year (leap-aware). Falls back to 31
  // until a month is picked so the field is never empty of options.
  const dayCount = useMemo(() => {
    if (monthNum && yearNum && yearNum >= MIN_YEAR && yearNum <= MAX_YEAR) {
      return daysInMonth(yearNum, monthNum);
    }
    if (monthNum) return daysInMonth(2000, monthNum); // leap year → most permissive
    return 31;
  }, [monthNum, yearNum]);

  const yearValid = yearNum !== null && yearNum >= MIN_YEAR && yearNum <= MAX_YEAR;

  // The assembled date, and whether it is real and not in the future.
  const iso =
    monthNum && day && yearValid && Number(day) >= 1 && Number(day) <= dayCount
      ? `${yearNum}-${pad(monthNum)}-${pad(Number(day))}`
      : null;

  const inFuture = iso ? new Date(`${iso}T00:00:00`) > NOW : false;
  const canSubmit = Boolean(iso && state && !inFuture);

  function submit() {
    if (!canSubmit || !iso) return;
    navigate(`/atlas?date=${iso}&state=${state}`);
  }

  const fieldClass =
    "rounded-md bg-gray-900/80 px-3 py-2.5 font-mono text-sm text-gray-100 ring-1 ring-white/10 " +
    "focus:outline-none focus:ring-2 focus:ring-cyan-400/60 [color-scheme:dark]";

  return (
    <div className="flex min-h-screen w-full flex-col bg-gray-950 px-5 py-7 text-gray-100 sm:px-10 sm:py-9">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] tracking-[0.28em] text-cyan-300/90">
            THE NIGHT YOU WERE BORN
          </div>
          <div className="mt-1.5 font-mono text-[11px] text-gray-500">
            a birthday, read back from the record &middot; nothing invented, only what was written down
          </div>
        </div>
        <Link
          to="/"
          className="whitespace-nowrap font-mono text-[11px] tracking-[0.24em] text-gray-500 hover:text-cyan-300"
        >
          DUCK COUNTDOWN
        </Link>
      </header>

      <main className="flex flex-1 flex-col justify-center py-12">
        <div className="max-w-2xl">
          <h1 className="font-display text-[1.7rem] font-medium leading-[1.25] text-gray-50 sm:text-[2.6rem] sm:leading-[1.2] lg:text-5xl lg:leading-[1.18]">
            What was the ground doing the night you were born?
          </h1>
          <p className="mt-6 max-w-xl font-body text-base leading-relaxed text-gray-400 sm:text-lg">
            The sky, the tide, the storms on file &mdash; all of it was already being
            recorded. Tell us the day and the place, and we&rsquo;ll read that night back
            to you.
          </p>

          <form
            className="mt-9"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">Month</span>
                <select
                  className={fieldClass}
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  aria-label="Birth month"
                >
                  <option value="">Month</option>
                  {MONTHS.map((name, i) => (
                    <option key={name} value={String(i + 1)}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">Day</span>
                <select
                  className={`${fieldClass} w-[5.5rem]`}
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                  aria-label="Birth day"
                >
                  <option value="">Day</option>
                  {Array.from({ length: dayCount }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={String(d)}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">Year</span>
                <input
                  type="number"
                  inputMode="numeric"
                  className={`${fieldClass} w-[6.5rem]`}
                  placeholder="1961"
                  min={MIN_YEAR}
                  max={MAX_YEAR}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  aria-label="Birth year"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">State</span>
                <select
                  className={`${fieldClass} min-w-[10rem]`}
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  aria-label="Birth state"
                >
                  <option value="">Where</option>
                  {STATE_OPTIONS.map((s) => (
                    <option key={s.abbr} value={s.abbr}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-7 flex items-center gap-4">
              <button
                type="submit"
                disabled={!canSubmit}
                className="rounded-md bg-cyan-400/10 px-5 py-2.5 font-mono text-sm text-cyan-200 ring-1 ring-cyan-400/40 transition hover:bg-cyan-400/20 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-cyan-400/10"
              >
                Read that night &rarr;
              </button>
              {inFuture && (
                <span className="font-mono text-[11px] text-gray-500">that day hasn&rsquo;t happened yet</span>
              )}
            </div>
          </form>
        </div>
      </main>

      <footer className="flex items-center justify-between font-mono text-[11px] text-gray-500">
        <Link to="/atlas" className="hover:text-cyan-300">
          &larr; the whole map
        </Link>
        <Link to="/morning" className="hover:text-gray-200">
          The Morning Line &rarr;
        </Link>
      </footer>
    </div>
  );
}
