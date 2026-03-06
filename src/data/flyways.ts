import type { Species } from "./types";

export const FLYWAY_COLORS = {
  Atlantic: "#3b82f6",
  Mississippi: "#22c55e",
  Central: "#f59e0b",
  Pacific: "#a855f7",
} as const;

export type FlywayName = keyof typeof FLYWAY_COLORS;

export const stateFlyways: Record<string, FlywayName> = {
  // Atlantic Flyway
  CT: "Atlantic", DE: "Atlantic", FL: "Atlantic", GA: "Atlantic",
  ME: "Atlantic", MD: "Atlantic", MA: "Atlantic", NH: "Atlantic",
  NJ: "Atlantic", NY: "Atlantic", NC: "Atlantic", PA: "Atlantic",
  RI: "Atlantic", SC: "Atlantic", VT: "Atlantic", VA: "Atlantic",
  WV: "Atlantic",
  // Mississippi Flyway
  AL: "Mississippi", AR: "Mississippi", IL: "Mississippi", IN: "Mississippi",
  IA: "Mississippi", KY: "Mississippi", LA: "Mississippi", MI: "Mississippi",
  MN: "Mississippi", MS: "Mississippi", MO: "Mississippi", OH: "Mississippi",
  TN: "Mississippi", WI: "Mississippi",
  // Central Flyway
  CO: "Central", KS: "Central", MT: "Central", NE: "Central",
  NM: "Central", ND: "Central", OK: "Central", SD: "Central",
  TX: "Central", WY: "Central",
  // Pacific Flyway
  AK: "Pacific", AZ: "Pacific", CA: "Pacific", HI: "Pacific",
  ID: "Pacific", NV: "Pacific", OR: "Pacific", UT: "Pacific",
  WA: "Pacific",
};

export function isFlywaySpecies(species: Species): boolean {
  return species === "duck" || species === "goose";
}
