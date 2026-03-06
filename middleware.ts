import { next } from '@vercel/edge';

const states: Record<string, { name: string; seasonOpen: string; bagLimit: number; flyway: string }> = {
  AL: { name: "Alabama", seasonOpen: "Nov 22, 2025", bagLimit: 6, flyway: "Mississippi" },
  AK: { name: "Alaska", seasonOpen: "Sep 6, 2025", bagLimit: 7, flyway: "Pacific" },
  AZ: { name: "Arizona", seasonOpen: "Oct 23, 2025", bagLimit: 7, flyway: "Pacific" },
  AR: { name: "Arkansas", seasonOpen: "Nov 22, 2025", bagLimit: 6, flyway: "Mississippi" },
  CA: { name: "California", seasonOpen: "Oct 18, 2025", bagLimit: 7, flyway: "Pacific" },
  CO: { name: "Colorado", seasonOpen: "Oct 11, 2025", bagLimit: 6, flyway: "Central" },
  CT: { name: "Connecticut", seasonOpen: "Oct 11, 2025", bagLimit: 6, flyway: "Atlantic" },
  DE: { name: "Delaware", seasonOpen: "Nov 1, 2025", bagLimit: 6, flyway: "Atlantic" },
  FL: { name: "Florida", seasonOpen: "Nov 29, 2025", bagLimit: 6, flyway: "Atlantic" },
  GA: { name: "Georgia", seasonOpen: "Nov 22, 2025", bagLimit: 6, flyway: "Atlantic" },
  HI: { name: "Hawaii", seasonOpen: "Nov 1, 2025", bagLimit: 7, flyway: "Pacific" },
  ID: { name: "Idaho", seasonOpen: "Oct 4, 2025", bagLimit: 7, flyway: "Pacific" },
  IL: { name: "Illinois", seasonOpen: "Oct 18, 2025", bagLimit: 6, flyway: "Mississippi" },
  IN: { name: "Indiana", seasonOpen: "Oct 25, 2025", bagLimit: 6, flyway: "Mississippi" },
  IA: { name: "Iowa", seasonOpen: "Oct 11, 2025", bagLimit: 6, flyway: "Mississippi" },
  KS: { name: "Kansas", seasonOpen: "Nov 1, 2025", bagLimit: 6, flyway: "Central" },
  KY: { name: "Kentucky", seasonOpen: "Nov 1, 2025", bagLimit: 6, flyway: "Mississippi" },
  LA: { name: "Louisiana", seasonOpen: "Nov 15, 2025", bagLimit: 6, flyway: "Mississippi" },
  ME: { name: "Maine", seasonOpen: "Oct 27, 2025", bagLimit: 6, flyway: "Atlantic" },
  MD: { name: "Maryland", seasonOpen: "Nov 1, 2025", bagLimit: 6, flyway: "Atlantic" },
  MA: { name: "Massachusetts", seasonOpen: "Oct 11, 2025", bagLimit: 6, flyway: "Atlantic" },
  MI: { name: "Michigan", seasonOpen: "Oct 4, 2025", bagLimit: 6, flyway: "Mississippi" },
  MN: { name: "Minnesota", seasonOpen: "Sep 27, 2025", bagLimit: 6, flyway: "Mississippi" },
  MS: { name: "Mississippi", seasonOpen: "Nov 22, 2025", bagLimit: 6, flyway: "Mississippi" },
  MO: { name: "Missouri", seasonOpen: "Oct 25, 2025", bagLimit: 6, flyway: "Mississippi" },
  MT: { name: "Montana", seasonOpen: "Oct 4, 2025", bagLimit: 7, flyway: "Central" },
  NE: { name: "Nebraska", seasonOpen: "Oct 11, 2025", bagLimit: 6, flyway: "Central" },
  NV: { name: "Nevada", seasonOpen: "Oct 18, 2025", bagLimit: 7, flyway: "Pacific" },
  NH: { name: "New Hampshire", seasonOpen: "Oct 2, 2025", bagLimit: 6, flyway: "Atlantic" },
  NJ: { name: "New Jersey", seasonOpen: "Oct 18, 2025", bagLimit: 6, flyway: "Atlantic" },
  NM: { name: "New Mexico", seasonOpen: "Nov 15, 2025", bagLimit: 6, flyway: "Central" },
  NY: { name: "New York", seasonOpen: "Oct 4, 2025", bagLimit: 6, flyway: "Atlantic" },
  NC: { name: "North Carolina", seasonOpen: "Nov 8, 2025", bagLimit: 6, flyway: "Atlantic" },
  ND: { name: "North Dakota", seasonOpen: "Sep 27, 2025", bagLimit: 6, flyway: "Central" },
  OH: { name: "Ohio", seasonOpen: "Oct 4, 2025", bagLimit: 6, flyway: "Mississippi" },
  OK: { name: "Oklahoma", seasonOpen: "Nov 1, 2025", bagLimit: 6, flyway: "Central" },
  OR: { name: "Oregon", seasonOpen: "Oct 4, 2025", bagLimit: 7, flyway: "Pacific" },
  PA: { name: "Pennsylvania", seasonOpen: "Oct 11, 2025", bagLimit: 6, flyway: "Atlantic" },
  RI: { name: "Rhode Island", seasonOpen: "Nov 15, 2025", bagLimit: 6, flyway: "Atlantic" },
  SC: { name: "South Carolina", seasonOpen: "Nov 22, 2025", bagLimit: 6, flyway: "Atlantic" },
  SD: { name: "South Dakota", seasonOpen: "Sep 27, 2025", bagLimit: 6, flyway: "Central" },
  TN: { name: "Tennessee", seasonOpen: "Nov 22, 2025", bagLimit: 6, flyway: "Mississippi" },
  TX: { name: "Texas", seasonOpen: "Nov 1, 2025", bagLimit: 6, flyway: "Central" },
  UT: { name: "Utah", seasonOpen: "Oct 11, 2025", bagLimit: 7, flyway: "Pacific" },
  VT: { name: "Vermont", seasonOpen: "Oct 11, 2025", bagLimit: 6, flyway: "Atlantic" },
  VA: { name: "Virginia", seasonOpen: "Nov 8, 2025", bagLimit: 6, flyway: "Atlantic" },
  WA: { name: "Washington", seasonOpen: "Oct 11, 2025", bagLimit: 7, flyway: "Pacific" },
  WV: { name: "West Virginia", seasonOpen: "Oct 4, 2025", bagLimit: 6, flyway: "Atlantic" },
  WI: { name: "Wisconsin", seasonOpen: "Sep 27, 2025", bagLimit: 6, flyway: "Mississippi" },
  WY: { name: "Wyoming", seasonOpen: "Sep 27, 2025", bagLimit: 6, flyway: "Central" },
};

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname.slice(1).toUpperCase();

  if (path.length === 2 && states[path]) {
    const state = states[path];
    const title = `${state.name} Duck Season | Duck Countdown`;
    const description = `${state.name} duck season opens ${state.seasonOpen}. ${state.flyway} Flyway. Bag limit: ${state.bagLimit}. Free countdown timer.`;
    const ogUrl = `https://duckcountdown.com/${path}`;

    const indexResponse = await fetch(new URL('/index.html', request.url));
    const html = await indexResponse.text();

    const modifiedHtml = html
      .replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
      .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${description}" />`)
      .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${title}" />`)
      .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${description}" />`)
      .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${ogUrl}" />`)
      .replace(/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${title}" />`)
      .replace(/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${description}" />`);

    return new Response(modifiedHtml, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
    });
  }

  return next();
}

export const config = {
  matcher: ['/((?!assets|favicon\\.ico|robots\\.txt|sitemap\\.xml|src\\/).*)'],
};
