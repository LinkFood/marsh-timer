import type { Species } from "./types";

export interface SpeciesConfig {
  label: string;
  emoji: string;
  colors: {
    open: string;
    soon: string;
    upcoming: string;
    closed: string;
    selected: string;
  };
}

export const speciesConfig: Record<Species, SpeciesConfig> = {
  all: {
    label: "All Signals",
    emoji: "\uD83C\uDF10",
    colors: {
      open: "#22d3ee",
      soon: "#06b6d4",
      upcoming: "#0891b2",
      closed: "#164e63",
      selected: "#67e8f9",
    },
  },
  duck: {
    label: "Duck",
    emoji: "\uD83E\uDD86",
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
    colors: {
      open: "#22c55e",
      soon: "#f59e0b",
      upcoming: "#2d2d3d",
      closed: "#262633",
      selected: "#8b7fc7",
    },
  },
};

export const SPECIES_ORDER: Species[] = ["all", "duck", "goose", "deer", "turkey", "dove"];
