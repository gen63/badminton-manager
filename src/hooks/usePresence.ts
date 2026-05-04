import { useEffect, useRef } from 'react';
import { writePresence, clearPresence, pruneStalePresence } from '../services/sessionService';
import { usePresenceStore } from '../stores/presenceStore';

/** ハートビート間隔 (ms) */
const HEARTBEAT_INTERVAL_MS = 20_000;
/** 直近書き込みがこの時間以内ならハートビートをスキップ */
const HEARTBEAT_SKIP_MS = 15_000;
/** タップ書き込みのスロットル間隔 (ms) */
const TAP_THROTTLE_MS = 3_000;
/** 漂流エントリと見なす閾値 (ms): 5分以上更新なし */
const STALE_PRESENCE_MS = 5 * 60 * 1000;

/**
 * 画面レベルのプレゼンス情報を Firestore に送出するフック
 *
 * - 呼び出し側（MainPage）がマウントしている間だけ自分の在席を通知する
 * - ハートビート (20s) / タップ (3s スロットル) / unmount でクリーンアップ
 * - マウント時に1回だけ他ユーザーの漂流エントリを掃除
 * - sessionId / currentUser が揃わない場合は完全に no-op
 */
export function usePresence(sessionId: string | null, currentUser: string | null) {
  // ハートビート/タップの最終書き込み時刻（書き込み節約のため ref 管理）
  const lastWriteAtRef = useRef<number>(0);
  const lastTapWriteAtRef = useRef<number>(0);
  // PRES1 fix: セッション ID 単位で「prune 済みか」を記録。
  // 旧実装は hook lifetime で 1 度しか prune しなかったため、セッション切替後の
  // 漂流エントリが掃除されなかった。
  const prunedSessionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!sessionId || !currentUser) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;
    let pruneTimerId: ReturnType<typeof setTimeout> | null = null;
    let tapListenerAttached = false;
    let cancelled = false;

    const heartbeat = () => {
      // 非可視タブからは送信しない（裏に回した直後の clearPresence を上書きしないため）
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastWriteAtRef.current < HEARTBEAT_SKIP_MS) return;
      lastWriteAtRef.current = now;
      void writePresence(sessionId, currentUser, { lastSeenAt: now });
    };

    const handleTap = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastTapWriteAtRef.current < TAP_THROTTLE_MS) return;
      lastTapWriteAtRef.current = now;
      lastWriteAtRef.current = now;
      void writePresence(sessionId, currentUser, { lastSeenAt: now, lastTapAt: now });
    };

    const start = () => {
      if (tapListenerAttached) return;
      heartbeat();
      intervalId = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
      window.addEventListener('pointerdown', handleTap, { passive: true });
      tapListenerAttached = true;
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // 可視に戻ったら listener / interval を確実にアタッチ
        // （非可視タブでマウントされた場合の救済を兼ねる）
        start();
      } else {
        // 裏に回してもエントリは残す。ハートビートが止まるので 45秒後に
        // 他ユーザー側の表示から自然に消える。これにより一瞬の
        // アプリ切替で lastTapAt が消えて「操作中」が落ちる問題を回避。
        // （タブを閉じた場合は beforeunload / unmount の clearPresence で削除）
        lastWriteAtRef.current = 0;
        lastTapWriteAtRef.current = 0;
      }
    };

    const handleBeforeUnload = () => {
      // fire-and-forget（updateDoc の async 完了は保証されない）
      void clearPresence(sessionId, currentUser);
    };

    // 初期状態が可視ならすぐ開始、そうでなければ次の visibilitychange を待つ
    if (document.visibilityState === 'visible') {
      start();
    }

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleBeforeUnload);

    // マウント時に1回だけ漂流エントリを掃除（セッション ID 単位で 1 回ずつ）
    if (!prunedSessionsRef.current.has(sessionId)) {
      prunedSessionsRef.current.add(sessionId);
      // 少し遅延させて subscribeToSession が初期プレゼンスを流し込むのを待つ
      pruneTimerId = setTimeout(() => {
        pruneTimerId = null;
        if (cancelled) return;
        const now = Date.now();
        const presence = usePresenceStore.getState().remotePresence;
        const stale = Object.entries(presence)
          .filter(([name, entry]) => name !== currentUser && now - entry.lastSeenAt > STALE_PRESENCE_MS)
          .map(([name]) => name);
        if (stale.length > 0) {
          void pruneStalePresence(sessionId, stale);
        }
      }, 1500);
    }

    return () => {
      cancelled = true;
      if (intervalId !== null) clearInterval(intervalId);
      if (pruneTimerId !== null) clearTimeout(pruneTimerId);
      if (tapListenerAttached) window.removeEventListener('pointerdown', handleTap);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      void clearPresence(sessionId, currentUser);
      lastWriteAtRef.current = 0;
      lastTapWriteAtRef.current = 0;
    };
  }, [sessionId, currentUser]);
}
