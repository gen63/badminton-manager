import { create } from 'zustand';
import type { Player } from '../types/player';

interface PlayerState {
  players: Player[];
  clearPlayers: () => void;
}

export const usePlayerStore = create<PlayerState>()((set) => ({
  players: [],
  clearPlayers: () => set({ players: [] }),
}));
