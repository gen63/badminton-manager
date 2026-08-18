/**
 * 練習が終わったセッションから自動退出する。
 *
 * 一覧の非表示条件（`isSessionVisible`）と同じ判定で、最後の試合が終わってから
 * 30 分（コートに試合が進行中なら継続、12 時間で絶対に打ち切り）経ったら、
 * セッションを離脱してセッション選択画面へ戻す。
 * 詳細: `docs/plans/2026-08-18-session-auto-exit-after-practice.md`
 *
 * サーバー側のスケジューラは無いので「全員を一斉に蹴る」処理は書けない。
 * **各端末が自分で判定して自分から出る**（＝ `leaveSession` で participants から
 * 自分を消す）ことで、結果的に全メンバーが退出した状態になる。アプリを閉じて
 * いる端末の分が participants に残るのは既存の離脱経路と同じ挙動。
 *
 * onSnapshot のコールバックは Firestore に更新が来たときしか走らず、練習終了後は
 * 無操作で更新が止まるため、時間経過で発火させるには自前の tick が要る。
 * `SessionSelectPage` の一覧フィルタと同じ 60 秒間隔に合わせている。
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { useGameStore } from '../stores/gameStore';
import { useSyncStatusStore } from '../stores/syncStatusStore';
import { useDevMode } from './useDevMode';
import {
  computeFirstMatchStartedAt,
  computeHasActiveCourt,
  computeLastMatchFinishedAt,
  shouldAutoExitSession,
} from '../lib/sessionArchive';
import { clearPresence, leaveSession } from '../services/sessionService';

/** 自動退出の判定間隔。一覧側の now tick と揃えている。 */
export const AUTO_EXIT_CHECK_INTERVAL_MS = 60_000;

export function useSessionAutoExit() {
  const sessionId = useSessionStore((s) => s.session?.id);
  const isGameStateLoaded = useSyncStatusStore((s) => s.isGameStateLoaded);
  const devMode = useDevMode();
  const navigate = useNavigate();

  // 依存配列の安定化（useFirebaseSync と同じパターン）
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  // 1 セッションにつき 1 回だけ退出させる（interval の多重発火防止）
  const exitedRef = useRef(false);

  useEffect(() => {
    if (!sessionId) {
      exitedRef.current = false;
      return;
    }
    // dev モードは一覧の非表示フィルタ自体をバイパスしているので、自動退出もしない。
    if (devMode) return;
    // 初回 gameState 受信前は matchHistory / courts が空で「試合未開始」に見えるため、
    // 誤判定を避けて受信完了まで待つ（判定自体は false になるので実害は無いが明示する）。
    if (!isGameStateLoaded) return;

    const check = () => {
      if (exitedRef.current) return;
      const { session, currentUser } = useSessionStore.getState();
      // セッション切替の途中で古い interval が発火するのを防ぐ
      if (!session || session.id !== sessionId) return;

      const { matchHistory, courts } = useGameStore.getState();
      const shouldExit = shouldAutoExitSession({
        firstMatchStartedAt: computeFirstMatchStartedAt(matchHistory),
        lastMatchFinishedAt: computeLastMatchFinishedAt(matchHistory),
        hasActiveCourt: computeHasActiveCourt(courts),
        config: session.config,
      });
      if (!shouldExit) return;

      exitedRef.current = true;
      // participants / presence から自分を消す（fire-and-forget、失敗しても退出は続行）
      if (currentUser) {
        void leaveSession(sessionId, currentUser);
        void clearPresence(sessionId, currentUser);
      }
      useSessionStore.getState().clearSession();
      // 退出理由は遷移先 SessionSelectPage が location.state.notice を見て表示する。
      navigateRef.current('/', {
        state: {
          notice: {
            type: 'warning',
            message: '練習終了から30分経過したためセッションを退出しました',
          },
        },
      });
    };

    // マウント直後にも 1 度判定する（PWA 再起動や、終了済みセッションへの
    // URL 直アクセスで 60 秒待たされないように）。
    check();
    const intervalId = setInterval(check, AUTO_EXIT_CHECK_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [sessionId, devMode, isGameStateLoaded]);
}
