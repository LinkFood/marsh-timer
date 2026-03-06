import type { Species } from "@/data/types";

const API_KEY = import.meta.env.VITE_EBIRD_API_KEY as string | undefined;
const BASE = "https://api.ebird.org/v2";

const SPECIES_CODES: Partial<Record<Species, string[]>> = {
  duck: ["mallar3", "gnwtea", "bnwtea", "norsho", "amewid", "norpin", "wodduc", "redhea", "canbac", "lessca"],
  goose: ["snogoo", "cangoo", "rosgoo", "grefgo", "grwfgo"],
  dove: ["mouedo", "whwdov", "eutdov"],
};

export interface EBirdSighting {
  comName: string;
  locName: string;
  obsDt: string;
  howMany: number | null;
  speciesCode: string;
}

export function canShowSightings(species: Species): boolean {
  return !!API_KEY && !!SPECIES_CODES[species];
}

export async function fetchRecentSightings(species: Species, stateAbbr: string): Promise<EBirdSighting[]> {
  if (!API_KEY || !SPECIES_CODES[species]) return [];

  const regionCode = `US-${stateAbbr}`;
  const url = `${BASE}/data/obs/${regionCode}/recent?back=7&maxResults=50`;

  try {
    const res = await fetch(url, {
      headers: { "X-eBirdApiToken": API_KEY },
    });
    if (!res.ok) return [];

    const data: EBirdSighting[] = await res.json();
    const validCodes = new Set(SPECIES_CODES[species]);

    return data
      .filter(d => validCodes.has(d.speciesCode))
      .slice(0, 8);
  } catch {
    return [];
  }
}

export function getEBirdRegionUrl(stateAbbr: string): string {
  return `https://ebird.org/region/US-${stateAbbr}`;
}
