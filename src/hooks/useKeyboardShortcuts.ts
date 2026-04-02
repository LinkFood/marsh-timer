import { useEffect, useCallback } from 'react';

interface KeyboardShortcutHandlers {
  toggleWeather: () => void;
  toggleBirdcast: () => void;
  toggleDelta: () => void;
  toggleFusion: () => void;
  toggleScores: () => void;
  toggleScoreboard: () => void;
  deselectState: () => void;
  selectByRank: (rank: number) => void;
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers) {
  const onKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't capture when typing in inputs/textareas/contenteditable
    const target = e.target as HTMLElement;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable
    ) return;

    // Ignore when modifier keys are held (allow browser shortcuts)
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key.toLowerCase()) {
      case 'w':
        handlers.toggleWeather();
        break;
      case 'b':
        handlers.toggleBirdcast();
        break;
      case 'd':
        handlers.toggleDelta();
        break;
      case 'f':
        handlers.toggleFusion();
        break;
      case 's':
        handlers.toggleScores();
        break;
      case '[':
        handlers.toggleScoreboard();
        break;
      case 'escape':
        handlers.deselectState();
        break;
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
        handlers.selectByRank(Number(e.key));
        break;
      default:
        return; // Don't preventDefault for unhandled keys
    }

    e.preventDefault();
  }, [handlers]);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);
}

/** Shortcut definitions for the help tooltip */
export const KEYBOARD_SHORTCUTS = [
  { key: 'W', description: 'Toggle Weather layer' },
  { key: 'B', description: 'Toggle BirdCast layer' },
  { key: 'D', description: 'Toggle 24h Change' },
  { key: 'F', description: 'Toggle FUSION mode' },
  { key: 'S', description: 'Toggle Scores layer' },
  { key: '[', description: 'Collapse/expand scoreboard' },
  { key: 'Esc', description: 'Deselect state' },
  { key: '1-5', description: 'Select state by rank' },
] as const;
