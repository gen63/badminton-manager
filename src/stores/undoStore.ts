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
  const settings = useSettingsStore.getState();
  return {
    courts: structuredClone(useGameStore.getState().courts),
    players: structuredClone(usePlayerStore.getState().players),
    matchHistory: structuredClone(useGameStore.getState().matchHistory),
    reservations: structuredClone(useReservationStore.getState().reservations),
    // UNDO5: sync 系の全設定を撮る（undo 後にユーザーが設定を変えても巻き戻せる）
    continuousMatchMode: settings.continuousMatchMode,
    recordScores: settings.recordScores,
    practiceType: settings.practiceType,
    timestamp: Date.now(),
  };
}

/** UndoEntry から Firestore に書き戻す GameState を組み立てる */
function entryToGameState(entry: UndoEntry): GameState {
  const current = useSettingsStore.getState();
  return {
    players: structuredClone(entry.players),
    courts: structuredClone(entry.courts),
    matchHistory: structuredClone(entry.matchHistory),
    reservations: entry.reservations ? structuredClone(entry.reservations) : [],
    // entry に含まれていない設定は現状維持（旧 entry 互換）
    settings: {
      recordScores: entry.recordScores ?? current.recordScores,
      continuousMatchMode: entry.continuousMatchMode ?? current.continuousMatchMode,
      practiceType: entry.practiceType ?? current.practiceType,
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
    const stackAtStart = get().undoStack;
    if (stackAtStart.length === 0) return false;

    const current = createCurrentSnapshot();
    const target = stackAtStart[stackAtStart.length - 1];

    const ok = await applyToFirestore(target);
    if (!ok) return false;

    // UNDO1: await の間に並行 pushUndo が走った可能性があるため、
    // set 時点の最新 stack に対して target を取り除く（functional update）。
    // target をリファレンス比較で除く（同一 snapshot は object identity で一意）。
    set((state) => ({
      undoStack: state.undoStack.filter((e) => e !== target),
      redoStack: [...state.redoStack, current],
    }));
    return true;
  },

  redo: async () => {
    const stackAtStart = get().redoStack;
    if (stackAtStart.length === 0) return false;

    const current = createCurrentSnapshot();
    const target = stackAtStart[stackAtStart.length - 1];

    const ok = await applyToFirestore(target);
    if (!ok) return false;

    set((state) => ({
      undoStack: [...state.undoStack, current],
      redoStack: state.redoStack.filter((e) => e !== target),
    }));
    return true;
  },

  clearAll: () => set({ undoStack: [], redoStack: [] }),
}));
