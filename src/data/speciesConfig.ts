import type { Species, SeasonType } from "./types";

export interface SpeciesConfig {
  label: string;
  emoji: string;
  seasonTypes: SeasonType[];
  colors: {
    open: string;
    soon: string;
    upcoming: string;
    closed: string;
    selected: string;
  };
}

export const speciesConfig: Record<Species, SpeciesConfig> = {
  duck: {
    label: "Duck",
    emoji: "\uD83E\uDD86",
    seasonTypes: ["regular", "early-teal", "youth"],
    colors: {
      open: "#22c55e",
      soon: "#f59e0b",
      upcoming: "#2d5a2d",
      closed: "#2d4a2d",
      selected: "#f5c842",
    },
  },
  goose: {
    label: "Goose",
    emoji: "\uD83E\uDEB9",
    seasonTypes: ["regular", "light-goose-conservation"],
    colors: {
      open: "#22c55e",
      soon: "#f59e0b",
      upcoming: "#1e3a5f",
      closed: "#1a3050",
      selected: "#5b9bd5",
    },
  },
  deer: {
    label: "Deer",
    emoji: "\uD83E\uDD8C",
    seasonTypes: ["archery", "rifle", "muzzleloader", "crossbow"],
    colors: {
      open: "#22c55e",
      soon: "#f59e0b",
      upcoming: "#4a2d0a",
      closed: "#3d2a10",
      selected: "#d4860b",
    },
  },
  turkey: {
    label: "Turkey",
    emoji: "\uD83E\uDD83",
    seasonTypes: ["spring", "fall"],
    colors: {
      open: "#22c55e",
      soon: "#f59e0b",
      upcoming: "#3d1a1a",
      closed: "#331616",
      selected: "#c94040",
    },
  },
  dove: {
    label: "Dove",
    emoji: "\uD83D\uDD4A\uFE0F",
    seasonTypes: ["regular", "special-white-wing"],
    colors: {
      open: "#22c55e",
      soon: "#f59e0b",
      upcoming: "#2d2d3d",
      closed: "#262633",
      selected: "#8b7fc7",
    },
  },
};

export const SPECIES_ORDER: Species[] = ["duck", "goose", "deer", "turkey", "dove"];
