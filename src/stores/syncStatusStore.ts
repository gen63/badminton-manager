import { create } from 'zustand';

/**
 * Firestore からの初回 gameState 受信が完了したかを追跡する。
 *
 * Phase 3 で zustand persist を sync 系ストアから外したため、ページマウント直後は
 * stores が空配列で、~50-200ms 後に onSnapshot が初回データを setState する。
 * その間に走る `useEffect` 内のロジック（例: コート数自動調整）が空配列を
 * 「正規の空状態」と誤認しないよう、`isGameStateLoaded` でガードする。
 *
 * セッション切替時に `useFirebaseSync` のクリーンアップで `false` にリセットする。
 */
interface SyncStatusState {
  isGameStateLoaded: boolean;
  setGameStateLoaded: (loaded: boolean) => void;
}

export const useSyncStatusStore = create<SyncStatusState>((set) => ({
  isGameStateLoaded: false,
  setGameStateLoaded: (loaded) => set({ isGameStateLoaded: loaded }),
}));
