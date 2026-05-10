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
  /** onSnapshot エラーで購読が切れている疑いがあるか（ERR2 用） */
  syncError: string | null;
  /**
   * `useFirebaseSync` の onSnapshot 再購読をキックするための nonce。
   * `SyncErrorBanner` の「再接続」ボタンや、タブが visible に戻った時に
   * increment される。`useFirebaseSync` が依存配列に含めて再購読する。
   */
  reconnectNonce: number;
  setGameStateLoaded: (loaded: boolean) => void;
  setSyncError: (msg: string | null) => void;
  requestReconnect: () => void;
}

export const useSyncStatusStore = create<SyncStatusState>((set) => ({
  isGameStateLoaded: false,
  syncError: null,
  reconnectNonce: 0,
  setGameStateLoaded: (loaded) => set({ isGameStateLoaded: loaded }),
  setSyncError: (msg) => set({ syncError: msg }),
  requestReconnect: () => set((s) => ({ reconnectNonce: s.reconnectNonce + 1 })),
}));
