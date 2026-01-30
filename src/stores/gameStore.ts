import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Court } from '../types/court';
import type { Match } from '../types/match';

interface GameState {
  courts: Court[];
  matchHistory: Match[];
  initializeCourts: (count: number) => void;
  updateCourt: (courtId: number, updates: Partial<Court>) => void;
  startGame: (courtId: number) => void;
  finishGame: (courtId: number, scoreA: number, scoreB: number) => void;
  resetAllCourts: () => void;
  addToHistory: (match: Match) => void;
  clearHistory: () => void;
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
    }),
    {
      name: 'badminton-game',
    }
  )
);
