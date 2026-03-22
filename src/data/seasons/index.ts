import type { Species, RegulatedSeason } from "../types";
import { duckSeasons } from "./duck";
import { gooseSeasons } from "./goose";
import { deerSeasons } from "./deer";
import { turkeySeasons } from "./turkey";
import { doveSeasons } from "./dove";

const allSeasons: RegulatedSeason[] = [
  ...duckSeasons,
  ...gooseSeasons,
  ...deerSeasons,
  ...turkeySeasons,
  ...doveSeasons,
];

const bySpecies = new Map<Species, RegulatedSeason[]>();
for (const s of allSeasons) {
  const arr = bySpecies.get(s.species) || [];
  arr.push(s);
  bySpecies.set(s.species, arr);
}

const ALL_STATE_ABBRS = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
]);

export function getSeasonsForSpecies(species: Species): RegulatedSeason[] {
  if (species === 'all') return [];
  return bySpecies.get(species) || [];
}

export function getSeasonsByState(species: Species, abbr: string): RegulatedSeason[] {
  return getSeasonsForSpecies(species).filter(s => s.abbreviation === abbr);
}

export function getStatesForSpecies(species: Species): Set<string> {
  if (species === 'all') return ALL_STATE_ABBRS;
  const seasons = getSeasonsForSpecies(species);
  return new Set(seasons.map(s => s.abbreviation));
}

export function getPrimarySeasonForState(species: Species, abbr: string): RegulatedSeason | undefined {
  if (species === 'all') return getPrimarySeasonForState('duck', abbr);
  const seasons = getSeasonsByState(species, abbr);
  if (seasons.length === 0) return undefined;
  // Prefer "regular" for duck/goose/dove, "rifle" for deer, "spring" for turkey
  const preferred: Record<Exclude<Species, 'all'>, string> = {
    duck: "regular", goose: "regular", deer: "rifle", turkey: "spring", dove: "regular",
  };
  return seasons.find(s => s.seasonType === preferred[species]) || seasons[0];
}

export function getAllSpeciesForState(abbr: string): Species[] {
  const result: Species[] = [];
  for (const [species, seasons] of bySpecies) {
    if (seasons.some(s => s.abbreviation === abbr)) {
      result.push(species);
    }
  }
  return result;
}

export { allSeasons };
