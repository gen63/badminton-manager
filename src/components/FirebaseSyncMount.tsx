import { type ReactNode } from 'react';
import { useFirebaseSync } from '../hooks/useFirebaseSync';
import { useLastSeen } from '../hooks/useLastSeen';

/**
 * Firestore セッション document の購読を App level で 1 度だけ起動するための薄いラッパー。
 *
 * `useFirebaseSync` フックは値を返さないので Context は提供しない（Phase 5 で
 * 旧 `FirebaseSyncContext` から rename）。ページ遷移
 * （/main → /players → /accounting 等）しても onSnapshot 購読が途切れない。
 *
 * `useLastSeen` の lastSeen ハートビートもここで起動する（App 全ページ計測のため）。
 */
export function FirebaseSyncMount({ children }: { children: ReactNode }) {
  useFirebaseSync();
  useLastSeen();
  return <>{children}</>;
}
