import { next } from '@vercel/edge';

const STATE_ABBRS = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
]);

const SPECIES = new Set(['duck', 'goose', 'deer', 'turkey', 'dove']);

function redirect(location: string) {
  return new Response(null, { status: 301, headers: { Location: location } });
}

// ---------------------------------------------------------------------------
// Social-crawler meta shims
// This is a client-rendered SPA — link-unfurl bots never execute JS, so they
// would only ever see the static index.html tags. For known routes we hand
// those bots (and only those bots — search engines render the SPA fine) a
// tiny HTML document with route-specific title/description/og:image.
// ---------------------------------------------------------------------------

const UNFURL_BOT_RE =
  /facebookexternalhit|facebot|twitterbot|slackbot|slack-imgproxy|linkedinbot|discordbot|whatsapp|telegrambot|pinterestbot|redditbot|embedly|iframely|skypeuripreview|vkshare/i;

// Canonical host — the apex 307s to www, so absolute URLs must use www to
// keep crawler image fetches redirect-free.
const SITE = 'https://www.duckcountdown.com';

interface RouteMeta {
  title: string;
  description: string;
  image: string;
}

const STATIC_META: Record<string, RouteMeta> = {
  '/': {
    title: 'Duck Countdown | Environmental Intelligence Platform',
    description:
      'Pick a day you remember. See what the Earth remembers. 7.6M readings across 25+ environmental domains and 50 states — weather, water, migration, and more.',
    image: '/api/og',
  },
  '/court': {
    title: 'The Court — Duck Countdown',
    description:
      'Predictions on trial. Every claim is filed before the outcome and graded in public against the record.',
    image: '/api/og?v=court',
  },
  '/cascade': {
    title: 'Strangest Days — Duck Countdown',
    description:
      'Days the layers moved together. Replays from the archive — told past-tense, every reading on the table. The archive replays. It never predicts.',
    image: '/api/og?v=cascade',
  },
  '/cascade/july-2026-heat': {
    title: 'The heat wave the layers saw coming — Duck Countdown',
    description:
      'The thermometer was silent. The ground, the ocean, and the birds were not. The archive replays 25 days — every line a real reading, not a forecast.',
    image: '/api/og?v=cascade&slug=july-2026-heat',
  },
  '/cascade/sept-2020-whiplash': {
    title: 'The weekend the weather snapped — Duck Countdown',
    description:
      'Labor Day weekend, 2020. 105°F Saturday, 108°F Sunday, snow by Tuesday. The archive replays 8 days — every point a real reading, none interpolated.',
    image: '/api/og?v=cascade&slug=sept-2020-whiplash',
  },
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function archiveDateMeta(pathname: string): RouteMeta | null {
  const m = pathname.match(/^\/date\/(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, ys, ms, ds] = m;
  const y = Number(ys);
  const mo = Number(ms);
  const d = Number(ds);
  if (y < 1600 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const formatted = `${MONTHS[mo - 1]} ${d}, ${y}`;
  return {
    title: `${formatted} | Duck Countdown Archive`,
    description: `What the environmental record shows for ${formatted} — weather, water, migration, and more, from a 7.6M-entry archive.`,
    image: `/api/og?v=date&d=${ys}-${ms}-${ds}`,
  };
}

function metaShim(pathname: string): Response | null {
  const meta = STATIC_META[pathname] ?? archiveDateMeta(pathname);
  if (!meta) return null;
  const canonical = `${SITE}${pathname === '/' ? '' : pathname}`;
  const image = `${SITE}${meta.image}`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${meta.title}</title>
<meta name="description" content="${meta.description}" />
<link rel="canonical" href="${canonical}" />
<meta property="og:site_name" content="Duck Countdown" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${meta.title}" />
<meta property="og:description" content="${meta.description}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${image}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${meta.title}" />
<meta name="twitter:description" content="${meta.description}" />
<meta name="twitter:image" content="${image}" />
</head>
<body>
<h1>${meta.title}</h1>
<p>${meta.description}</p>
<p><a href="${canonical}">${canonical}</a></p>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}

export default function middleware(request: Request) {
  const url = new URL(request.url);
  const segments = url.pathname.slice(1).split('/').filter(Boolean);

  // Link-unfurl bots get route-specific meta tags (they never execute JS)
  const ua = request.headers.get('user-agent') ?? '';
  if (request.method === 'GET' && UNFURL_BOT_RE.test(ua)) {
    const shim = metaShim(url.pathname);
    if (shim) return shim;
  }

  // /XX → /?state=XX
  if (segments.length === 1 && segments[0].length === 2) {
    const abbr = segments[0].toUpperCase();
    if (STATE_ABBRS.has(abbr)) return redirect(`/?state=${abbr}`);
  }

  // /duck (legacy species landing) → /
  if (segments.length === 1 && SPECIES.has(segments[0].toLowerCase())) {
    return redirect('/');
  }

  // /duck/XX (legacy species + state) → /?state=XX
  if (segments.length === 2 && SPECIES.has(segments[0].toLowerCase())) {
    const abbr = segments[1].toUpperCase();
    if (STATE_ABBRS.has(abbr)) return redirect(`/?state=${abbr}`);
  }

  return next();
}

export const config = {
  matcher: ['/((?!api\\/|assets|favicon\\.ico|robots\\.txt|sitemap\\.xml|src\\/).*)'],
};
