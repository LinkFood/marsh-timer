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

export default function middleware(request: Request) {
  const url = new URL(request.url);
  const segments = url.pathname.slice(1).split('/').filter(Boolean);

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
  matcher: ['/((?!assets|favicon\\.ico|robots\\.txt|sitemap\\.xml|src\\/).*)'],
};
