import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Player } from '../types/player';

interface PlayerState {
  players: Player[];
  addPlayers: (names: string[]) => void;
  removePlayer: (id: string) => void;
  toggleRest: (id: string) => void;
  updatePlayer: (id: string, updates: Partial<Player>) => void;
  clearPlayers: () => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set) => ({
      players: [],
      addPlayers: (names) =>
        set((state) => ({
          players: [
            ...state.players,
            ...names.map((name) => ({
              id: `player-${Date.now()}-${Math.random()}`,
              name,
              isResting: false,
              gamesPlayed: 0,
              lastPlayedAt: null,
            })),
          ],
        })),
      removePlayer: (id) =>
        set((state) => ({
          players: state.players.filter((p) => p.id !== id),
        })),
      toggleRest: (id) =>
        set((state) => ({
          players: state.players.map((p) =>
            p.id === id ? { ...p, isResting: !p.isResting } : p
          ),
        })),
      updatePlayer: (id, updates) =>
        set((state) => ({
          players: state.players.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        })),
      clearPlayers: () => set({ players: [] }),
    }),
    {
      name: 'badminton-players',
    }
  )
);
