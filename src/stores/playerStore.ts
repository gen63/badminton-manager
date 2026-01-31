import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Player } from '../types/player';

interface PlayerInput {
  name: string;
  rating?: number;
}

interface PlayerState {
  players: Player[];
  addPlayers: (inputs: PlayerInput[]) => void;
  removePlayer: (id: string) => void;
  toggleRest: (id: string) => void;
  updatePlayer: (id: string, updates: Partial<Player>) => void;
  clearPlayers: () => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set) => ({
      players: [],
      addPlayers: (inputs) =>
        set((state) => ({
          players: [
            ...state.players,
            ...inputs.map((input) => ({
              id: `player-${Date.now()}-${Math.random()}`,
              name: input.name,
              rating: input.rating,
              isResting: true, // 全員休憩で開始（チェックイン待ち）
              gamesPlayed: 0,
              lastPlayedAt: null,
              activatedAt: null, // 休憩解除時に設定
            })),
          ],
        })),
      removePlayer: (id) =>
        set((state) => ({
          players: state.players.filter((p) => p.id !== id),
        })),
      toggleRest: (id) =>
        set((state) => ({
          players: state.players.map((p) => {
            if (p.id !== id) return p;
            
            const newIsResting = !p.isResting;
            
            // 休憩→待機の場合、activatedAtを記録（既に設定済みなら上書きしない）
            const newActivatedAt = 
              !newIsResting && p.activatedAt === null
                ? Date.now()
                : p.activatedAt;
            
            return {
              ...p,
              isResting: newIsResting,
              activatedAt: newActivatedAt,
            };
          }),
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
