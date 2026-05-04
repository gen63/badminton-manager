import { create } from 'zustand';
import type { UndoEntry } from '../types/undo';
import { useGameStore } from './gameStore';
import { usePlayerStore } from './playerStore';
import { useReservationStore } from './reservationStore';
import { useSettingsStore } from './settingsStore';
import { useSessionStore } from './sessionStore';
import { overwriteGameState } from '../services/sessionMutations';
import type { GameState } from '../services/sessionService';

const MAX_UNDO = 50;

interface UndoState {
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  pushUndo: () => void;
  /** 現在状態をスナップ → スタック先頭を Firestore に書き戻す。成功すると true。 */
  undo: () => Promise<boolean>;
  /** undo の逆 */
  redo: () => Promise<boolean>;
  clearAll: () => void;
}

function createCurrentSnapshot(): UndoEntry {
  return {
    courts: structuredClone(useGameStore.getState().courts),
    players: structuredClone(usePlayerStore.getState().players),
    matchHistory: structuredClone(useGameStore.getState().matchHistory),
    reservations: structuredClone(useReservationStore.getState().reservations),
    continuousMatchMode: useSettingsStore.getState().continuousMatchMode,
    timestamp: Date.now(),
  };
}

/** UndoEntry から Firestore に書き戻す GameState を組み立てる */
function entryToGameState(entry: UndoEntry): GameState {
  const settingsStore = useSettingsStore.getState();
  return {
    players: structuredClone(entry.players),
    courts: structuredClone(entry.courts),
    matchHistory: structuredClone(entry.matchHistory),
    reservations: entry.reservations ? structuredClone(entry.reservations) : [],
    settings: {
      // sync 系の設定は entry に含まれているもの以外は現状維持
      recordScores: settingsStore.recordScores,
      continuousMatchMode:
        entry.continuousMatchMode ?? settingsStore.continuousMatchMode,
      practiceType: settingsStore.practiceType,
    },
  };
}

/**
 * スタックに退避していた snapshot を Firestore に書き戻す。
 * 戻り値は書き込みが走ったかどうか。
 */
async function applyToFirestore(entry: UndoEntry): Promise<boolean> {
  const sessionId = useSessionStore.getState().session?.id;
  if (!sessionId) return false;
  try {
    await overwriteGameState(sessionId, entryToGameState(entry));
    return true;
  } catch (err) {
    console.error('[UndoStore] Failed to restore snapshot to Firestore:', err);
    return false;
  }
}

export const useUndoStore = create<UndoState>()((set, get) => ({
  undoStack: [],
  redoStack: [],

  pushUndo: () => {
    const snapshot = createCurrentSnapshot();
    set(() => ({
      undoStack: [...get().undoStack.slice(-(MAX_UNDO - 1)), snapshot],
      redoStack: [],
    }));
  },

  undo: async () => {
    const { undoStack, redoStack } = get();
    if (undoStack.length === 0) return false;

    const current = createCurrentSnapshot();
    const target = undoStack[undoStack.length - 1];

    const ok = await applyToFirestore(target);
    if (!ok) return false;

    set({
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, current],
    });
    return true;
  },

  redo: async () => {
    const { undoStack, redoStack } = get();
    if (redoStack.length === 0) return false;

    const current = createCurrentSnapshot();
    const target = redoStack[redoStack.length - 1];

    const ok = await applyToFirestore(target);
    if (!ok) return false;

    set({
      undoStack: [...undoStack, current],
      redoStack: redoStack.slice(0, -1),
    });
    return true;
  },

  clearAll: () => set({ undoStack: [], redoStack: [] }),
}));
