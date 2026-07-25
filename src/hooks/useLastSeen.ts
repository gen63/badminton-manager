import { useEffect, useRef } from 'react';
import { writeLastSeen } from '../services/sessionService';
import { useSessionStore } from '../stores/sessionStore';

/** ハートビート間隔 (ms) */
const HEARTBEAT_INTERVAL_MS = 60_000;
/** 直近書き込みからこの時間以内ならハートビートをスキップ */
const HEARTBEAT_SKIP_MS = 30_000;

/**
 * 「最後にアプリ画面を見た時刻」を Firestore に送出するフック
 *
 * `usePresence`（MainPage 限定・裏に回ると削除）とは別物で、App ルートに常時
 * マウントし全ページで計測を継続する。参加者管理ページの「放置検知」表示用の
 * 補助データを作るだけなので、失敗してもアプリの主要機能には影響しない。
 *
 * - マウント時 & 可視復帰時に即書き込み、以後 60 秒ごとにハートビート
 *   （非可視タブ / 直近書き込みから 30 秒未満はスキップ）
 * - 非可視化 / ページ離脱時に「離脱時刻」として最後に 1 回書き込む（fire-and-forget）
 * - `presence` と違い削除書き込みは行わない（履歴として残すのが目的）
 * - sessionId / currentUser が揃わない場合は完全に no-op
 */
export function useLastSeen(): void {
  const sessionId = useSessionStore((s) => s.session?.id);
  const currentUser = useSessionStore((s) => s.currentUser);

  // 直近書き込み時刻（書き込み節約のため ref 管理）
  const lastWriteAtRef = useRef<number>(0);

  useEffect(() => {
    if (!sessionId || !currentUser) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const heartbeat = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastWriteAtRef.current < HEARTBEAT_SKIP_MS) return;
      lastWriteAtRef.current = now;
      void writeLastSeen(sessionId, currentUser, now);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        heartbeat();
      } else {
        // 裏に回った瞬間の時刻を「離脱時刻」として残す（fire-and-forget）
        const now = Date.now();
        lastWriteAtRef.current = now;
        void writeLastSeen(sessionId, currentUser, now);
      }
    };

    const handleBeforeUnload = () => {
      // fire-and-forget（updateDoc の async 完了は保証されない）
      void writeLastSeen(sessionId, currentUser, Date.now());
    };

    // マウント時に即書き込み（可視の場合のみ。非可視でマウントされた場合は次の
    // visibilitychange を待つ）
    heartbeat();
    intervalId = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      if (intervalId !== null) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      lastWriteAtRef.current = 0;
    };
  }, [sessionId, currentUser]);
}
