export type Species = "all" | "duck" | "goose" | "deer" | "turkey" | "dove";

export type SeasonType =
  | "regular"
  | "early-teal"
  | "youth"
  | "light-goose-conservation"
  | "archery"
  | "rifle"
  | "muzzleloader"
  | "crossbow"
  | "spring"
  | "fall"
  | "special-white-wing";

export interface DateRange {
  open: string;  // ISO "2025-11-22"
  close: string; // ISO "2026-01-30"
}

export interface HuntingSeason {
  species: Species;
  state: string;
  abbreviation: string;
  seasonType: SeasonType;
  zone: string;
  zoneSlug: string;
  dates: DateRange[];
  bagLimit: number;
  flyway?: string;
  weapon?: string;
  notes?: string;
  verified: boolean;
  sourceUrl?: string;
  seasonYear: string;
}

export const VALID_SPECIES: Species[] = ["all", "duck", "goose", "deer", "turkey", "dove"];

export function isValidSpecies(s: string): s is Species {
  return VALID_SPECIES.includes(s as Species);
}
