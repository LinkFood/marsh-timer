import { next } from '@vercel/edge';

const speciesLabels: Record<string, string> = {
  duck: "Duck", goose: "Goose", deer: "Deer", turkey: "Turkey", dove: "Dove",
};

const states: Record<string, { name: string; seasonOpen: string; bagLimit: number; flyway: string }> = {
  AL: { name: "Alabama", seasonOpen: "Nov 28, 2025", bagLimit: 6, flyway: "Mississippi" },
  AK: { name: "Alaska", seasonOpen: "Sep 1, 2025", bagLimit: 8, flyway: "Pacific" },
  AZ: { name: "Arizona", seasonOpen: "Oct 23, 2025", bagLimit: 7, flyway: "Pacific" },
  AR: { name: "Arkansas", seasonOpen: "Nov 22, 2025", bagLimit: 6, flyway: "Mississippi" },
  CA: { name: "California", seasonOpen: "Oct 4, 2025", bagLimit: 7, flyway: "Pacific" },
  CO: { name: "Colorado", seasonOpen: "Oct 4, 2025", bagLimit: 6, flyway: "Central" },
  CT: { name: "Connecticut", seasonOpen: "Oct 11, 2025", bagLimit: 6, flyway: "Atlantic" },
  DE: { name: "Delaware", seasonOpen: "Nov 1, 2025", bagLimit: 6, flyway: "Atlantic" },
  FL: { name: "Florida", seasonOpen: "Nov 22, 2025", bagLimit: 6, flyway: "Atlantic" },
  GA: { name: "Georgia", seasonOpen: "Nov 22, 2025", bagLimit: 6, flyway: "Atlantic" },
  HI: { name: "Hawaii", seasonOpen: "Nov 1, 2025", bagLimit: 6, flyway: "Pacific" },
  ID: { name: "Idaho", seasonOpen: "Oct 4, 2025", bagLimit: 7, flyway: "Pacific" },
  IL: { name: "Illinois", seasonOpen: "Oct 18, 2025", bagLimit: 6, flyway: "Mississippi" },
  IN: { name: "Indiana", seasonOpen: "Oct 18, 2025", bagLimit: 6, flyway: "Mississippi" },
  IA: { name: "Iowa", seasonOpen: "Sep 27, 2025", bagLimit: 6, flyway: "Mississippi" },
  KS: { name: "Kansas", seasonOpen: "Oct 11, 2025", bagLimit: 6, flyway: "Central" },
  KY: { name: "Kentucky", seasonOpen: "Nov 27, 2025", bagLimit: 6, flyway: "Mississippi" },
  LA: { name: "Louisiana", seasonOpen: "Nov 8, 2025", bagLimit: 6, flyway: "Mississippi" },
  ME: { name: "Maine", seasonOpen: "Oct 4, 2025", bagLimit: 6, flyway: "Atlantic" },
  MD: { name: "Maryland", seasonOpen: "Oct 4, 2025", bagLimit: 6, flyway: "Atlantic" },
  MA: { name: "Massachusetts", seasonOpen: "Oct 25, 2025", bagLimit: 6, flyway: "Atlantic" },
  MI: { name: "Michigan", seasonOpen: "Sep 27, 2025", bagLimit: 6, flyway: "Mississippi" },
  MN: { name: "Minnesota", seasonOpen: "Sep 27, 2025", bagLimit: 6, flyway: "Mississippi" },
  MS: { name: "Mississippi", seasonOpen: "Nov 28, 2025", bagLimit: 6, flyway: "Mississippi" },
  MO: { name: "Missouri", seasonOpen: "Nov 1, 2025", bagLimit: 6, flyway: "Mississippi" },
  MT: { name: "Montana", seasonOpen: "Oct 4, 2025", bagLimit: 6, flyway: "Central" },
  NE: { name: "Nebraska", seasonOpen: "Oct 4, 2025", bagLimit: 6, flyway: "Central" },
  NV: { name: "Nevada", seasonOpen: "Sep 27, 2025", bagLimit: 7, flyway: "Pacific" },
  NH: { name: "New Hampshire", seasonOpen: "Oct 2, 2025", bagLimit: 6, flyway: "Atlantic" },
  NJ: { name: "New Jersey", seasonOpen: "Oct 18, 2025", bagLimit: 6, flyway: "Atlantic" },
  NM: { name: "New Mexico", seasonOpen: "Nov 15, 2025", bagLimit: 6, flyway: "Central" },
  NY: { name: "New York", seasonOpen: "Oct 11, 2025", bagLimit: 6, flyway: "Atlantic" },
  NC: { name: "North Carolina", seasonOpen: "Oct 16, 2025", bagLimit: 6, flyway: "Atlantic" },
  ND: { name: "North Dakota", seasonOpen: "Sep 27, 2025", bagLimit: 6, flyway: "Central" },
  OH: { name: "Ohio", seasonOpen: "Oct 18, 2025", bagLimit: 6, flyway: "Mississippi" },
  OK: { name: "Oklahoma", seasonOpen: "Oct 4, 2025", bagLimit: 6, flyway: "Central" },
  OR: { name: "Oregon", seasonOpen: "Oct 11, 2025", bagLimit: 7, flyway: "Pacific" },
  PA: { name: "Pennsylvania", seasonOpen: "Oct 11, 2025", bagLimit: 6, flyway: "Atlantic" },
  RI: { name: "Rhode Island", seasonOpen: "Oct 25, 2025", bagLimit: 6, flyway: "Atlantic" },
  SC: { name: "South Carolina", seasonOpen: "Nov 22, 2025", bagLimit: 6, flyway: "Atlantic" },
  SD: { name: "South Dakota", seasonOpen: "Sep 27, 2025", bagLimit: 6, flyway: "Central" },
  TN: { name: "Tennessee", seasonOpen: "Nov 29, 2025", bagLimit: 6, flyway: "Mississippi" },
  TX: { name: "Texas", seasonOpen: "Oct 18, 2025", bagLimit: 6, flyway: "Central" },
  UT: { name: "Utah", seasonOpen: "Oct 4, 2025", bagLimit: 7, flyway: "Pacific" },
  VT: { name: "Vermont", seasonOpen: "Oct 11, 2025", bagLimit: 6, flyway: "Atlantic" },
  VA: { name: "Virginia", seasonOpen: "Oct 11, 2025", bagLimit: 6, flyway: "Atlantic" },
  WA: { name: "Washington", seasonOpen: "Oct 11, 2025", bagLimit: 7, flyway: "Pacific" },
  WV: { name: "West Virginia", seasonOpen: "Oct 4, 2025", bagLimit: 6, flyway: "Atlantic" },
  WI: { name: "Wisconsin", seasonOpen: "Sep 27, 2025", bagLimit: 6, flyway: "Mississippi" },
  WY: { name: "Wyoming", seasonOpen: "Oct 1, 2025", bagLimit: 7, flyway: "Central" },
};

const validSpecies = new Set(["duck", "goose", "deer", "turkey", "dove"]);

function buildJsonLd(type: string, data: Record<string, unknown>) {
  return `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": type, ...data })}</script>`;
}

async function injectOgTags(request: Request, title: string, description: string, ogUrl: string, jsonLd?: string) {
  const indexResponse = await fetch(new URL('/index.html', request.url));
  const html = await indexResponse.text();

  let modifiedHtml = html
    .replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${description}" />`)
    .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${title}" />`)
    .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${description}" />`)
    .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${ogUrl}" />`)
    .replace(/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${title}" />`)
    .replace(/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${description}" />`);

  if (jsonLd) {
    modifiedHtml = modifiedHtml.replace('</head>', `${jsonLd}\n</head>`);
  }

  return new Response(modifiedHtml, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const segments = url.pathname.slice(1).split('/').filter(Boolean);

  // Legacy redirect: /TX → /duck/TX (301)
  if (segments.length === 1 && segments[0].length === 2) {
    const abbr = segments[0].toUpperCase();
    if (states[abbr]) {
      return new Response(null, {
        status: 301,
        headers: { Location: `/duck/${abbr}` },
      });
    }
  }

  // /:species — species landing page
  if (segments.length === 1 && validSpecies.has(segments[0].toLowerCase())) {
    const species = segments[0].toLowerCase();
    const label = speciesLabels[species] || species;
    const title = `${label} Intelligence | Duck Countdown`;
    const description = `${label} environmental signals, migration patterns, and convergence analysis across all 50 states. Powered by 486K+ embedded data points.`;
    const ogUrl = `https://duckcountdown.com/${species}`;
    const jsonLd = buildJsonLd("WebApplication", {
      name: title,
      description,
      url: ogUrl,
      applicationCategory: "EnvironmentalMonitoring",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      isPartOf: { "@type": "WebApplication", name: "Duck Countdown", url: "https://duckcountdown.com" },
    });
    return injectOgTags(request, title, description, ogUrl, jsonLd);
  }

  // /:species/:stateAbbr — species + state page
  if (segments.length === 2 && validSpecies.has(segments[0].toLowerCase())) {
    const species = segments[0].toLowerCase();
    const abbr = segments[1].toUpperCase();
    const state = states[abbr];
    if (state) {
      const label = speciesLabels[species] || species;
      const title = `${state.name} ${label} Intelligence | Duck Countdown`;
      const description = `Environmental convergence data for ${state.name}. Weather patterns, wildlife movement, water levels, and historical pattern matching.`;
      const ogUrl = `https://duckcountdown.com/${species}/${abbr}`;
      const jsonLd = buildJsonLd("WebApplication", {
        name: `${state.name} ${label} Intelligence | Duck Countdown`,
        description,
        url: ogUrl,
        applicationCategory: "EnvironmentalMonitoring",
        operatingSystem: "Web",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        spatialCoverage: { "@type": "Place", name: state.name, address: { "@type": "PostalAddress", addressRegion: abbr, addressCountry: "US" } },
      });
      return injectOgTags(request, title, description, ogUrl, jsonLd);
    }
  }

  return next();
}

export const config = {
  matcher: ['/((?!assets|favicon\\.ico|robots\\.txt|sitemap\\.xml|src\\/).*)'],
};
