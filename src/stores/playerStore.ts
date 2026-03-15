import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Player } from '../types/player';

interface PlayerInput {
  name: string;
  rating?: number;
  gender?: 'M' | 'F';
}

interface PlayerState {
  players: Player[];
  addPlayers: (inputs: PlayerInput[]) => { added: number; skipped: string[] };
  removePlayer: (id: string) => void;
  toggleRest: (id: string) => void;
  updatePlayer: (id: string, updates: Partial<Player>) => void;
  clearPlayers: () => void;
  toggleOperationStatus: (id: string, field: 'payment' | 'roster' | 'checkin') => void;
  setPaymentAmount: (id: string, amount: number) => void;
  setAllPlayersResting: () => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      players: [],
      addPlayers: (inputs) => {
        const existingNames = new Set(get().players.map((p) => p.name.trim()));
        const seen = new Set<string>();
        const skipped: string[] = [];
        const toAdd: PlayerInput[] = [];

        for (const input of inputs) {
          const trimmedName = input.name.trim();
          if (!trimmedName) continue;
          if (existingNames.has(trimmedName) || seen.has(trimmedName)) {
            skipped.push(trimmedName);
            continue;
          }
          seen.add(trimmedName);
          toAdd.push(input);
        }

        if (toAdd.length > 0) {
          set((state) => ({
            players: [
              ...state.players,
              ...toAdd.map((input) => ({
                id: crypto.randomUUID(),
                name: input.name.trim(),
                rating: input.rating,
                gender: input.gender,
                isResting: true, // 全員休憩で開始（チェックイン待ち）
                gamesPlayed: 0,
                lastPlayedAt: 0, // 未プレイ時は0
                activatedAt: 0, // 休憩解除時に設定
              })),
            ],
          }));
        }

        return { added: toAdd.length, skipped };
      },
      removePlayer: (id) =>
        set((state) => ({
          players: state.players.filter((p) => p.id !== id),
        })),
      toggleRest: (id) =>
        set((state) => ({
          players: state.players.map((p) => {
            if (p.id !== id) return p;
            
            const newIsResting = !p.isResting;
            
            // 休憩→待機の場合、activatedAtを記録（既に設定済み（>0）なら上書きしない）
            const newActivatedAt = 
              !newIsResting && p.activatedAt === 0
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
      toggleOperationStatus: (id, field) =>
        set((state) => ({
          players: state.players.map((p) => {
            if (p.id !== id) return p;
            const current = p.operationStatus || { payment: false, roster: false, checkin: false };
            const newValue = !current[field];
            
            // 支払い完了時に時刻を記録
            const updates: Partial<Player> = {
              operationStatus: {
                ...current,
                [field]: newValue,
              },
            };
            
            if (field === 'payment' && newValue) {
              updates.paymentTimestamp = Date.now();
            }
            
            return {
              ...p,
              ...updates,
            };
          }),
        })),
      setPaymentAmount: (id, amount) =>
        set((state) => ({
          players: state.players.map((p) =>
            p.id === id ? { ...p, paymentAmount: amount } : p
          ),
        })),
      setAllPlayersResting: () =>
        set((state) => ({
          players: state.players.map((p) => ({
            ...p,
            isResting: true,
          })),
        })),
    }),
    {
      name: 'badminton-players',
    }
  )
);
