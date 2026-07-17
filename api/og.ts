import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

// ---------------------------------------------------------------------------
// Route-aware OG cards for duckcountdown.com
//   /api/og                                     → site-wide card
//   /api/og?v=court                             → The Court
//   /api/og?v=cascade                           → Strangest Days index
//   /api/og?v=cascade&slug=july-2026-heat       → July 2026 heat cascade
//   /api/og?v=cascade&slug=sept-2020-whiplash   → Sept 2020 whiplash cascade
//   /api/og?v=date&d=YYYY-MM-DD                 → Archive day view
//   /api/og?v=ask|plant|atlas|morning|born      → The doors + wings
// Unknown params fall back to the site-wide card. No free-text params —
// every string rendered on a card is defined in this file.
// ---------------------------------------------------------------------------

const playfairData = fetch(
  new URL('./_fonts/PlayfairDisplay-Bold.ttf', import.meta.url),
).then((r) => r.arrayBuffer());
const loraData = fetch(new URL('./_fonts/Lora-Regular.ttf', import.meta.url)).then(
  (r) => r.arrayBuffer(),
);

interface CardCopy {
  kicker: string;
  headlineMuted?: string;
  headline: string;
  sub: string;
}

const CARDS: Record<string, CardCopy> = {
  home: {
    kicker: 'DUCK COUNTDOWN',
    headlineMuted: 'What today is, here.',
    headline: 'The living almanac of American ground.',
    sub: 'What it rhymes with · what followed · every sentence traceable to a row',
  },
  ask: {
    kicker: 'ASK THE ARCHIVE',
    headline: 'Ask the record a question.',
    sub: '7.6M recorded readings · 50 states · receipts attached, never a forecast',
  },
  plant: {
    kicker: 'THE PLANTING PAGE',
    headline: 'When to plant, from the record.',
    sub: "76 years of recorded frost · your state's own odds · never a guess",
  },
  atlas: {
    kicker: 'THE ATLAS',
    headline: 'Descend into your ground.',
    sub: 'What this place is doing today, and what its own record rhymes with',
  },
  morning: {
    kicker: 'THE MORNING LINE',
    headline: 'The daily page.',
    sub: "What's forming this morning, read against the record — graded in public",
  },
  born: {
    kicker: 'THE DAY YOU WERE BORN',
    headline: 'What the ground was doing.',
    sub: 'Weather, water, and the moon — straight from the recorded archive',
  },
  court: {
    kicker: 'THE COURT · PUBLIC DOCKET',
    headline: 'Predictions on trial.',
    sub: 'Claims filed before the outcome. Graded in public against the record.',
  },
  cascade: {
    kicker: 'STRANGEST DAYS',
    headline: 'Days the layers moved together',
    sub: 'Replays from the archive — told past-tense, every reading on the table.',
  },
  'july-2026-heat': {
    kicker: 'THE CASCADE · JULY 2026',
    headline: 'The heat wave the layers saw coming',
    sub: '25 days replayed. Every line a real reading — not a forecast.',
  },
  'sept-2020-whiplash': {
    kicker: 'STRANGEST DAYS · SEPTEMBER 2020',
    headline: 'The weekend the weather snapped',
    sub: '105°F Saturday. 108°F Sunday. Snow by Tuesday.',
  },
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseArchiveDate(d: string | null): string | null {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const [y, m, day] = d.split('-').map(Number);
  if (y < 1600 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, day));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== day) return null;
  return `${MONTHS[m - 1]} ${day}, ${y}`;
}

function pickCard(params: URLSearchParams): CardCopy {
  const v = params.get('v');
  if (v === 'court') return CARDS.court;
  if (v === 'cascade') {
    const slug = params.get('slug');
    if (slug && CARDS[slug]) return CARDS[slug];
    return CARDS.cascade;
  }
  if (v === 'date') {
    const formatted = parseArchiveDate(params.get('d'));
    if (formatted) {
      return {
        kicker: 'THE ARCHIVE',
        headline: formatted,
        sub: 'What the environmental record shows for this day — weather, water, migration, and more.',
      };
    }
  }
  if (v && CARDS[v]) return CARDS[v]; // ask / plant / atlas / morning / born
  return CARDS.home;
}

// Satori element helper — plain objects instead of JSX so this file needs no
// JSX build step.
function el(type: string, style: Record<string, unknown>, children?: unknown) {
  return { type, props: { style, children } };
}

export default async function handler(req: Request) {
  const { searchParams } = new URL(req.url);
  const card = pickCard(searchParams);
  const [playfair, lora] = await Promise.all([playfairData, loraData]);

  const headlineSize = card.headline.length > 30 ? 62 : 74;

  const tree = el(
    'div',
    {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '64px 72px',
      backgroundColor: '#030712',
      backgroundImage:
        'radial-gradient(circle at 85% 10%, rgba(34, 211, 238, 0.10), transparent 55%), radial-gradient(circle at 10% 95%, rgba(13, 148, 136, 0.10), transparent 50%)',
    },
    [
      // Brand row
      el(
        'div',
        { display: 'flex', alignItems: 'center', gap: '14px' },
        [
          el('div', {
            width: '12px',
            height: '12px',
            backgroundColor: '#22d3ee',
            borderRadius: '2px',
          }),
          el(
            'div',
            {
              fontFamily: 'Lora',
              fontSize: '21px',
              letterSpacing: '4px',
              color: 'rgba(103, 232, 249, 0.85)',
            },
            'DUCK COUNTDOWN — ENVIRONMENTAL INTELLIGENCE',
          ),
        ],
      ),
      // Headline block
      el(
        'div',
        { display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1000px' },
        [
          el(
            'div',
            {
              fontFamily: 'Lora',
              fontSize: '20px',
              letterSpacing: '5px',
              color: 'rgba(255, 255, 255, 0.45)',
            },
            card.kicker,
          ),
          el(
            'div',
            { display: 'flex', flexDirection: 'column' },
            [
              ...(card.headlineMuted
                ? [
                    el(
                      'div',
                      {
                        fontFamily: 'Playfair',
                        fontSize: `${headlineSize}px`,
                        lineHeight: 1.15,
                        color: 'rgba(255, 255, 255, 0.55)',
                      },
                      card.headlineMuted,
                    ),
                  ]
                : []),
              el(
                'div',
                {
                  fontFamily: 'Playfair',
                  fontSize: `${headlineSize}px`,
                  lineHeight: 1.15,
                  color: 'rgba(255, 255, 255, 0.96)',
                },
                card.headline,
              ),
            ],
          ),
          el(
            'div',
            {
              fontFamily: 'Lora',
              fontSize: '29px',
              lineHeight: 1.45,
              color: 'rgba(255, 255, 255, 0.62)',
            },
            card.sub,
          ),
        ],
      ),
      // Footer row
      el(
        'div',
        {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid rgba(34, 211, 238, 0.25)',
          paddingTop: '26px',
        },
        [
          el(
            'div',
            { fontFamily: 'Lora', fontSize: '23px', color: 'rgba(255, 255, 255, 0.75)' },
            'duckcountdown.com',
          ),
          el(
            'div',
            {
              fontFamily: 'Lora',
              fontSize: '19px',
              letterSpacing: '3px',
              color: 'rgba(255, 255, 255, 0.35)',
            },
            'THE ARCHIVE REPLAYS. IT NEVER PREDICTS.',
          ),
        ],
      ),
    ],
  );

  return new ImageResponse(tree as never, {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'Playfair', data: playfair, weight: 700, style: 'normal' },
      { name: 'Lora', data: lora, weight: 400, style: 'normal' },
    ],
    headers: {
      'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
    },
  });
}
