import { type ReactNode } from 'react';
import { useFirebaseSync } from '../hooks/useFirebaseSync';

/**
 * Firestore セッション document の購読を App level で 1 度だけ起動するための薄いラッパー。
 *
 * `useFirebaseSync` フックは値を返さないので Context は提供しない（Phase 5 で
 * 旧 `FirebaseSyncContext` から rename）。ページ遷移
 * （/main → /players → /accounting 等）しても onSnapshot 購読が途切れない。
 */
export function FirebaseSyncMount({ children }: { children: ReactNode }) {
  useFirebaseSync();
  return <>{children}</>;
}
