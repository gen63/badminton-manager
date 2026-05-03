import { type ReactNode } from 'react';
import { useFirebaseSync } from '../hooks/useFirebaseSync';

/**
 * Firebase 双方向同期をアプリ全体で維持する Provider。
 *
 * `useFirebaseSync` を App level でマウントすることで、ページ遷移
 * （/main → /players → /accounting 等）しても onSnapshot 購読が
 * 途切れないようにする。
 *
 * Phase 3 で `useFirebaseSync` が値を返さなくなったため、Provider は
 * フックを呼ぶだけ（context API は撤去済み）。
 */
export function FirebaseSyncProvider({ children }: { children: ReactNode }) {
  useFirebaseSync();
  return <>{children}</>;
}
