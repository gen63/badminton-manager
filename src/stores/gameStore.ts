import { create } from 'zustand';
import type { Court } from '../types/court';
import type { Match } from '../types/match';

interface GameState {
  courts: Court[];
  matchHistory: Match[];
  clearHistory: () => void;
}

export const useGameStore = create<GameState>()((set) => ({
  courts: [],
  matchHistory: [],
  clearHistory: () => set({ matchHistory: [] }),
}));
