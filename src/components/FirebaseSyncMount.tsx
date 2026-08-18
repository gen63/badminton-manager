import { type ReactNode } from 'react';
import { useFirebaseSync } from '../hooks/useFirebaseSync';
import { useLastSeen } from '../hooks/useLastSeen';
import { useSessionAutoExit } from '../hooks/useSessionAutoExit';

/**
 * Firestore セッション document の購読を App level で 1 度だけ起動するための薄いラッパー。
 *
 * `useFirebaseSync` フックは値を返さないので Context は提供しない（Phase 5 で
 * 旧 `FirebaseSyncContext` から rename）。ページ遷移
 * （/main → /players → /accounting 等）しても onSnapshot 購読が途切れない。
 *
 * `useLastSeen` の lastSeen ハートビートもここで起動する（App 全ページ計測のため）。
 *
 * `useSessionAutoExit`（練習終了後の自動退出）も同じ理由でここに置く。会計ページ等
 * どの画面にいても発火させる必要があるため。
 */
export function FirebaseSyncMount({ children }: { children: ReactNode }) {
  useFirebaseSync();
  useLastSeen();
  useSessionAutoExit();
  return <>{children}</>;
}
