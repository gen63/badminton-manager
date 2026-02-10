import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UndoEntry } from '../types/undo';
import { useGameStore } from './gameStore';
import { usePlayerStore } from './playerStore';

const MAX_UNDO = 50;

interface UndoState {
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  pushUndo: (entry: UndoEntry) => void;
  undo: () => boolean;
  redo: () => boolean;
  clearAll: () => void;
}

function createCurrentSnapshot(): UndoEntry {
  return {
    courts: structuredClone(useGameStore.getState().courts),
    players: structuredClone(usePlayerStore.getState().players),
    matchHistory: structuredClone(useGameStore.getState().matchHistory),
    timestamp: Date.now(),
  };
}

function restoreSnapshot(entry: UndoEntry) {
  useGameStore.setState({
    courts: structuredClone(entry.courts),
    matchHistory: structuredClone(entry.matchHistory),
  });
  usePlayerStore.setState({
    players: structuredClone(entry.players),
  });
}

export const useUndoStore = create<UndoState>()(
  persist(
    (set, get) => ({
      undoStack: [],
      redoStack: [],

      pushUndo: (entry) =>
        set(() => ({
          undoStack: [...get().undoStack.slice(-(MAX_UNDO - 1)), entry],
          redoStack: [],
        })),

      undo: () => {
        const { undoStack, redoStack } = get();
        if (undoStack.length === 0) return false;

        const current = createCurrentSnapshot();
        const target = undoStack[undoStack.length - 1];

        restoreSnapshot(target);

        set({
          undoStack: undoStack.slice(0, -1),
          redoStack: [...redoStack, current],
        });
        return true;
      },

      redo: () => {
        const { undoStack, redoStack } = get();
        if (redoStack.length === 0) return false;

        const current = createCurrentSnapshot();
        const target = redoStack[redoStack.length - 1];

        restoreSnapshot(target);

        set({
          undoStack: [...undoStack, current],
          redoStack: redoStack.slice(0, -1),
        });
        return true;
      },

      clearAll: () => set({ undoStack: [], redoStack: [] }),
    }),
    {
      name: 'undo-storage',
    }
  )
);
