import { useState, useCallback } from "react";
import type { Species } from "@/data/types";

const STORAGE_KEY = "hunt-favorites";
const LEGACY_KEY = "duck-favorites";
const MAX_FAVORITES = 5;

function migrateLegacy(): string[] {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return [];
    const parsed = JSON.parse(legacy);
    if (!Array.isArray(parsed)) return [];
    const migrated = parsed.slice(0, MAX_FAVORITES).map((abbr: string) => `duck:${abbr}`);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    localStorage.removeItem(LEGACY_KEY);
    return migrated;
  } catch {
    return [];
  }
}

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return migrateLegacy();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_FAVORITES) : [];
  } catch {
    return [];
  }
}

function saveFavorites(favorites: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
}

export function makeFavoriteKey(species: Species, abbr: string): string {
  return `${species}:${abbr}`;
}

export function parseFavoriteKey(key: string): { species: Species; abbr: string } | null {
  const [species, abbr] = key.split(":");
  if (!species || !abbr) return null;
  return { species: species as Species, abbr };
}

export interface UseFavoritesReturn {
  favorites: string[];
  toggleFavorite: (species: Species, abbr: string) => void;
  isFavorite: (species: Species, abbr: string) => boolean;
  getFavoritesForSpecies: (species: Species) => string[];
}

export function useFavorites(): UseFavoritesReturn {
  const [favorites, setFavorites] = useState<string[]>(loadFavorites);

  const toggleFavorite = useCallback((species: Species, abbr: string) => {
    const key = makeFavoriteKey(species, abbr);
    setFavorites((prev) => {
      const idx = prev.indexOf(key);
      let next: string[];
      if (idx >= 0) {
        next = prev.filter((k) => k !== key);
      } else {
        if (prev.length >= MAX_FAVORITES) return prev;
        next = [...prev, key];
      }
      saveFavorites(next);
      return next;
    });
  }, []);

  const isFavorite = useCallback(
    (species: Species, abbr: string) => favorites.includes(makeFavoriteKey(species, abbr)),
    [favorites]
  );

  const getFavoritesForSpecies = useCallback(
    (species: Species) => {
      return favorites
        .map(parseFavoriteKey)
        .filter((p): p is { species: Species; abbr: string } => p !== null && p.species === species)
        .map(p => p.abbr);
    },
    [favorites]
  );

  return { favorites, toggleFavorite, isFavorite, getFavoritesForSpecies };
}
