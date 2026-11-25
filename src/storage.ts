import type { Circuit } from './sim/types';

const KEY = 'chip-lab-v1';

export interface SaveData {
  level: number;
  completed: number[];
  bestChips: Record<number, number>;
  circuits: Record<number, Circuit>;
  muted: boolean;
}

const fresh = (): SaveData => ({
  level: 1,
  completed: [],
  bestChips: {},
  circuits: {},
  muted: false,
});

export function loadSave(): SaveData {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<SaveData> | null;
    if (!raw || typeof raw !== 'object') return fresh();
    return {
      level: Number.isInteger(raw.level) ? raw.level! : 1,
      completed: Array.isArray(raw.completed) ? raw.completed.filter(Number.isInteger) : [],
      bestChips: raw.bestChips && typeof raw.bestChips === 'object' ? raw.bestChips : {},
      circuits: raw.circuits && typeof raw.circuits === 'object' ? raw.circuits : {},
      muted: raw.muted === true,
    };
  } catch {
    return fresh();
  }
}

export function writeSave(save: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Ignore storage quota / private mode errors.
  }
}
