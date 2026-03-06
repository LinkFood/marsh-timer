#!/usr/bin/env node
/**
 * Generate sitemap.xml from season data files.
 * Usage: node scripts/generate-sitemap.mjs
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..", "src", "data", "seasons");
const OUT = join(import.meta.dirname, "..", "public", "sitemap.xml");
const BASE = "https://duckcountdown.com";

const SPECIES = ["duck", "goose", "deer", "turkey", "dove"];

function extractStates(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const abbrs = new Set();
  const regex = /abbreviation: "([A-Z]{2})"/g;
  let m;
  while ((m = regex.exec(content)) !== null) {
    abbrs.add(m[1]);
  }
  return [...abbrs].sort();
}

const urls = [];

// Home
urls.push({ loc: `${BASE}/`, priority: "1.0", changefreq: "weekly" });

for (const species of SPECIES) {
  // Species landing page
  urls.push({ loc: `${BASE}/${species}`, priority: "0.9", changefreq: "weekly" });

  // State pages
  const filePath = join(ROOT, `${species}.ts`);
  try {
    const states = extractStates(filePath);
    for (const abbr of states) {
      urls.push({ loc: `${BASE}/${species}/${abbr}`, priority: "0.7", changefreq: "monthly" });
    }
  } catch (e) {
    console.error(`Warning: Could not read ${species}.ts`);
  }
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join("\n")}
</urlset>
`;

writeFileSync(OUT, xml, "utf-8");
console.log(`Generated sitemap.xml with ${urls.length} URLs`);
