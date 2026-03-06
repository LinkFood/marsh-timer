import { useState, useCallback } from "react";

const STORAGE_KEY = "duck-favorites";
const MAX_FAVORITES = 5;

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_FAVORITES) : [];
  } catch {
    return [];
  }
}

function saveFavorites(favorites: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
}

export interface UseFavoritesReturn {
  favorites: string[];
  toggleFavorite: (abbr: string) => void;
  isFavorite: (abbr: string) => boolean;
}

export function useFavorites(): UseFavoritesReturn {
  const [favorites, setFavorites] = useState<string[]>(loadFavorites);

  const toggleFavorite = useCallback((abbr: string) => {
    setFavorites((prev) => {
      const idx = prev.indexOf(abbr);
      let next: string[];
      if (idx >= 0) {
        next = prev.filter((a) => a !== abbr);
      } else {
        if (prev.length >= MAX_FAVORITES) return prev;
        next = [...prev, abbr];
      }
      saveFavorites(next);
      return next;
    });
  }, []);

  const isFavorite = useCallback(
    (abbr: string) => favorites.includes(abbr),
    [favorites]
  );

  return { favorites, toggleFavorite, isFavorite };
}
