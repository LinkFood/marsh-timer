export interface DuckSeason {
  state: string;
  abbreviation: string;
  zone: string;
  flyway: string;
  bagLimit: number;
  seasonOpen: string; // ISO date
  seasonClose: string;
  notes?: string;
}

export const duckSeasons: DuckSeason[] = [
  { state: "Alabama", abbreviation: "AL", zone: "South Zone", flyway: "Mississippi", bagLimit: 6, seasonOpen: "2025-11-22", seasonClose: "2026-01-30" },
  { state: "Alaska", abbreviation: "AK", zone: "Varies", flyway: "Pacific", bagLimit: 7, seasonOpen: "2025-09-06", seasonClose: "2025-12-07" },
  { state: "Arkansas", abbreviation: "AR", zone: "South Zone", flyway: "Mississippi", bagLimit: 6, seasonOpen: "2025-11-22", seasonClose: "2026-01-30" },
  { state: "California", abbreviation: "CA", zone: "Pacific Flyway", flyway: "Pacific", bagLimit: 7, seasonOpen: "2025-10-18", seasonClose: "2026-01-25" },
  { state: "Colorado", abbreviation: "CO", zone: "High Plains", flyway: "Central", bagLimit: 6, seasonOpen: "2025-10-11", seasonClose: "2026-01-18" },
  { state: "Florida", abbreviation: "FL", zone: "South Zone", flyway: "Atlantic", bagLimit: 6, seasonOpen: "2025-11-29", seasonClose: "2026-01-25" },
  { state: "Georgia", abbreviation: "GA", zone: "South Zone", flyway: "Atlantic", bagLimit: 6, seasonOpen: "2025-11-22", seasonClose: "2026-01-30" },
  { state: "Idaho", abbreviation: "ID", zone: "Pacific Flyway", flyway: "Pacific", bagLimit: 7, seasonOpen: "2025-10-04", seasonClose: "2026-01-12" },
  { state: "Illinois", abbreviation: "IL", zone: "North Zone", flyway: "Mississippi", bagLimit: 6, seasonOpen: "2025-10-18", seasonClose: "2025-12-21" },
  { state: "Indiana", abbreviation: "IN", zone: "Mississippi Flyway", flyway: "Mississippi", bagLimit: 6, seasonOpen: "2025-10-25", seasonClose: "2026-01-04" },
  { state: "Iowa", abbreviation: "IA", zone: "Mississippi Flyway", flyway: "Mississippi", bagLimit: 6, seasonOpen: "2025-10-11", seasonClose: "2025-12-14" },
  { state: "Kansas", abbreviation: "KS", zone: "Central Flyway", flyway: "Central", bagLimit: 6, seasonOpen: "2025-11-01", seasonClose: "2025-12-21" },
  { state: "Kentucky", abbreviation: "KY", zone: "Mississippi Flyway", flyway: "Mississippi", bagLimit: 6, seasonOpen: "2025-11-01", seasonClose: "2026-01-11" },
  { state: "Louisiana", abbreviation: "LA", zone: "South Zone", flyway: "Mississippi", bagLimit: 6, seasonOpen: "2025-11-15", seasonClose: "2026-01-30" },
  { state: "Maryland", abbreviation: "MD", zone: "Atlantic Flyway", flyway: "Atlantic", bagLimit: 6, seasonOpen: "2025-11-01", seasonClose: "2026-01-25" },
  { state: "Michigan", abbreviation: "MI", zone: "North Zone", flyway: "Mississippi", bagLimit: 6, seasonOpen: "2025-10-04", seasonClose: "2025-11-23" },
  { state: "Minnesota", abbreviation: "MN", zone: "North Zone", flyway: "Mississippi", bagLimit: 6, seasonOpen: "2025-09-27", seasonClose: "2025-11-09" },
  { state: "Mississippi", abbreviation: "MS", zone: "South Zone", flyway: "Mississippi", bagLimit: 6, seasonOpen: "2025-11-22", seasonClose: "2026-01-30" },
  { state: "Missouri", abbreviation: "MO", zone: "Mississippi Flyway", flyway: "Mississippi", bagLimit: 6, seasonOpen: "2025-10-25", seasonClose: "2026-01-04" },
  { state: "Montana", abbreviation: "MT", zone: "Central Flyway", flyway: "Central", bagLimit: 7, seasonOpen: "2025-10-04", seasonClose: "2025-12-21" },
  { state: "Nebraska", abbreviation: "NE", zone: "Central Flyway", flyway: "Central", bagLimit: 6, seasonOpen: "2025-10-11", seasonClose: "2025-12-14" },
  { state: "Nevada", abbreviation: "NV", zone: "Pacific Flyway", flyway: "Pacific", bagLimit: 7, seasonOpen: "2025-10-18", seasonClose: "2026-01-25" },
  { state: "New York", abbreviation: "NY", zone: "North Zone", flyway: "Atlantic", bagLimit: 6, seasonOpen: "2025-10-04", seasonClose: "2025-11-23" },
  { state: "North Carolina", abbreviation: "NC", zone: "South Zone", flyway: "Atlantic", bagLimit: 6, seasonOpen: "2025-11-08", seasonClose: "2026-01-24" },
  { state: "North Dakota", abbreviation: "ND", zone: "Central Flyway", flyway: "Central", bagLimit: 6, seasonOpen: "2025-09-27", seasonClose: "2025-11-09" },
  { state: "Ohio", abbreviation: "OH", zone: "Mississippi Flyway", flyway: "Mississippi", bagLimit: 6, seasonOpen: "2025-10-04", seasonClose: "2025-11-23" },
  { state: "Oklahoma", abbreviation: "OK", zone: "Central Flyway", flyway: "Central", bagLimit: 6, seasonOpen: "2025-11-01", seasonClose: "2025-12-21" },
  { state: "Oregon", abbreviation: "OR", zone: "Pacific Flyway", flyway: "Pacific", bagLimit: 7, seasonOpen: "2025-10-04", seasonClose: "2026-01-25" },
  { state: "South Carolina", abbreviation: "SC", zone: "South Zone", flyway: "Atlantic", bagLimit: 6, seasonOpen: "2025-11-22", seasonClose: "2026-01-30" },
  { state: "South Dakota", abbreviation: "SD", zone: "Central Flyway", flyway: "Central", bagLimit: 6, seasonOpen: "2025-09-27", seasonClose: "2025-11-09" },
  { state: "Tennessee", abbreviation: "TN", zone: "Mississippi Flyway", flyway: "Mississippi", bagLimit: 6, seasonOpen: "2025-11-22", seasonClose: "2026-01-25" },
  { state: "Texas", abbreviation: "TX", zone: "South Zone", flyway: "Central", bagLimit: 6, seasonOpen: "2025-11-01", seasonClose: "2026-01-25" },
  { state: "Utah", abbreviation: "UT", zone: "Pacific Flyway", flyway: "Pacific", bagLimit: 7, seasonOpen: "2025-10-11", seasonClose: "2026-01-18" },
  { state: "Virginia", abbreviation: "VA", zone: "Atlantic Flyway", flyway: "Atlantic", bagLimit: 6, seasonOpen: "2025-11-08", seasonClose: "2026-01-24" },
  { state: "Washington", abbreviation: "WA", zone: "Pacific Flyway", flyway: "Pacific", bagLimit: 7, seasonOpen: "2025-10-11", seasonClose: "2026-01-25" },
  { state: "Wisconsin", abbreviation: "WI", zone: "North Zone", flyway: "Mississippi", bagLimit: 6, seasonOpen: "2025-09-27", seasonClose: "2025-11-09" },
];

// Map FIPS codes to abbreviations for D3 map
export const fipsToAbbr: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
  "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY",
};

export const abbrToFips: Record<string, string> = Object.fromEntries(
  Object.entries(fipsToAbbr).map(([k, v]) => [v, k])
);
