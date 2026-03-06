import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Court } from '../types/court';
import type { Match } from '../types/match';

interface GameState {
  courts: Court[];
  matchHistory: Match[];
  initializeCourts: (count: number) => void;
  resizeCourts: (count: number) => void;
  removeCourtById: (courtId: number) => void;
  updateCourt: (courtId: number, updates: Partial<Court>) => void;
  startGame: (courtId: number) => void;
  finishGame: (courtId: number, scoreA: number, scoreB: number) => void;
  resetAllCourts: () => void;
  addToHistory: (match: Match) => void;
  clearHistory: () => void;
  deleteMatch: (matchId: string) => void;
}

export const useGameStore = create<GameState>()(
  persist(
    (set) => ({
      courts: [],
      matchHistory: [],
      initializeCourts: (count) =>
        set({
          courts: Array.from({ length: count }, (_, i) => ({
            id: i + 1,
            teamA: ['', ''],
            teamB: ['', ''],
            scoreA: 0,
            scoreB: 0,
            isPlaying: false,
            startedAt: null,
            finishedAt: null,
          })),
        }),
      resizeCourts: (count) =>
        set((state) => {
          const existing = state.courts;
          if (count >= existing.length) {
            // 増やす場合: 既存を保持し、新しいコートを追加
            const newCourts = Array.from({ length: count - existing.length }, (_, i) => ({
              id: existing.length + i + 1,
              teamA: ['', ''] as [string, string],
              teamB: ['', ''] as [string, string],
              scoreA: 0,
              scoreB: 0,
              isPlaying: false,
              startedAt: null as number | null,
              finishedAt: null as number | null,
            }));
            return { courts: [...existing, ...newCourts] };
          }
          // 減らす場合: 使用中コートを優先保持し、空きコートを末尾から削除
          const isCourtActive = (c: Court) => c.isPlaying || (c.teamA[0] && c.teamA[0] !== '');
          const activeCourts = existing.filter(isCourtActive);
          const emptyCourts = existing.filter(c => !isCourtActive(c));
          // 使用中コートが収まらない場合は使用中コートを優先保持
          if (activeCourts.length >= count) {
            const kept = activeCourts.slice(0, count);
            return {
              courts: kept
                .sort((a, b) => a.id - b.id)
                .map((c, i) => ({ ...c, id: i + 1 })),
            };
          }
          // 使用中コートを保持 + 空きコートで残り枠を埋める
          const kept = [...activeCourts, ...emptyCourts.slice(0, count - activeCourts.length)];
          // IDを1から振り直す
          return {
            courts: kept
              .sort((a, b) => a.id - b.id)
              .map((c, i) => ({ ...c, id: i + 1 })),
          };
        }),
      removeCourtById: (courtId) =>
        set((state) => ({
          courts: state.courts
            .filter((c) => c.id !== courtId)
            .map((c, i) => ({ ...c, id: i + 1 })),
        })),
      updateCourt: (courtId, updates) =>
        set((state) => ({
          courts: state.courts.map((c) =>
            c.id === courtId ? { ...c, ...updates } : c
          ),
        })),
      startGame: (courtId) =>
        set((state) => ({
          courts: state.courts.map((c) =>
            c.id === courtId
              ? { ...c, isPlaying: true, startedAt: Date.now() }
              : c
          ),
        })),
      finishGame: (courtId, scoreA, scoreB) =>
        set((state) => {
          const court = state.courts.find((c) => c.id === courtId);
          if (!court) return state;

          const match: Match = {
            id: `match-${Date.now()}-${courtId}`,
            courtId,
            teamA: court.teamA,
            teamB: court.teamB,
            scoreA,
            scoreB,
            startedAt: court.startedAt || Date.now(),
            finishedAt: Date.now(),
            winner: scoreA > scoreB ? 'A' : 'B',
          };

          return {
            courts: state.courts.map((c) =>
              c.id === courtId
                ? {
                    ...c,
                    scoreA,
                    scoreB,
                    isPlaying: false,
                    finishedAt: Date.now(),
                  }
                : c
            ),
            matchHistory: [...state.matchHistory, match],
          };
        }),
      resetAllCourts: () =>
        set((state) => ({
          courts: state.courts.map((c) => ({
            ...c,
            teamA: ['', ''],
            teamB: ['', ''],
            scoreA: 0,
            scoreB: 0,
            isPlaying: false,
            startedAt: null,
            finishedAt: null,
          })),
        })),
      addToHistory: (match) =>
        set((state) => ({
          matchHistory: [...state.matchHistory, match],
        })),
      clearHistory: () => set({ matchHistory: [] }),
      deleteMatch: (matchId) =>
        set((state) => ({
          matchHistory: state.matchHistory.filter((m) => m.id !== matchId),
        })),
    }),
    {
      name: 'badminton-game',
    }
  )
);
