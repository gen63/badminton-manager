import { createContext, useContext, type ReactNode } from 'react';
import { useFirebaseSync } from '../hooks/useFirebaseSync';
import type { GameState } from '../services/sessionService';

interface FirebaseSyncApi {
  prepareDirectTransaction: () => void;
  completeDirectTransaction: (writtenState?: GameState) => void;
  pushImmediate: () => Promise<GameState | null>;
}

const FirebaseSyncContext = createContext<FirebaseSyncApi | null>(null);

/**
 * Firebase双方向同期をアプリ全体で維持するProvider
 *
 * useFirebaseSyncをApp levelでマウントすることで、
 * ページ遷移（/main → /players → /accounting 等）しても
 * 同期が途切れないようにする。
 */
export function FirebaseSyncProvider({ children }: { children: ReactNode }) {
  const syncApi = useFirebaseSync();
  return (
    <FirebaseSyncContext.Provider value={syncApi}>
      {children}
    </FirebaseSyncContext.Provider>
  );
}

/**
 * Firebase同期APIを取得するhook
 *
 * MainPageなど、直接Transactionを実行するページで使用。
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useFirebaseSyncContext(): FirebaseSyncApi {
  const ctx = useContext(FirebaseSyncContext);
  if (!ctx) {
    throw new Error('useFirebaseSyncContext must be used within FirebaseSyncProvider');
  }
  return ctx;
}
