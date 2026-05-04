/**
 * Firestore のセッション document を購読し、`gameState` を直接ローカル zustand
 * ストアに反映する。
 *
 * Phase 3 で「Firestore を真実のソースに一本化」する設計に切替えた:
 *   - 書き込みは `sessionMutations.X`（runTransaction）が直接 Firestore を更新する。
 *   - 読み取りは onSnapshot を受信したらローカル merge せずに `setState` する。
 *   - 旧 3-way merge / `lastSyncedState` / `sync_base_*` sessionStorage /
 *     `pushBlockMs` / `prepareDirectTransaction` 系は撤去済み。
 *
 * 詳細は `docs/plans/2026-05-03-firestore-as-source-of-truth.md` を参照。
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { timestampToMillis } from '../lib/firestoreUtils';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useReservationStore } from '../stores/reservationStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSyncStatusStore } from '../stores/syncStatusStore';
import { notifyMatchStart } from '../lib/notifications';
import { useToast } from './useToast';
import type { Court } from '../types/court';
import type { GameState } from '../services/sessionService';

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** 試合開始通知の重複防止（プロセス全体で共有） */
const notifiedMatches = new Set<string>();

export function useFirebaseSync() {
  const sessionId = useSessionStore((s) => s.session?.id);
  const toast = useToast();
  const navigate = useNavigate();

  // 依存配列の安定化
  const toastRef = useRef(toast);
  const navigateRef = useRef(navigate);
  useEffect(() => {
    toastRef.current = toast;
    navigateRef.current = navigate;
  }, [toast, navigate]);

  const sessionDeletedNotified = useRef(false);

  useEffect(() => {
    if (!sessionId || !db) {
      // セッション未選択 / Firebase 未設定では「読み込み済み」扱い（待機する Firestore なし）
      useSyncStatusStore.getState().setGameStateLoaded(true);
      return;
    }

    sessionDeletedNotified.current = false;
    useSyncStatusStore.getState().setGameStateLoaded(false);

    const unsub = onSnapshot(
      doc(db, 'sessions', sessionId),
      (snap) => {
        // セッション削除
        if (!snap.exists()) {
          if (!sessionDeletedNotified.current) {
            sessionDeletedNotified.current = true;
            toastRef.current.error('セッションが削除されました');
            useSessionStore.getState().clearSession();
            setTimeout(() => navigateRef.current('/'), 1000);
          }
          return;
        }

        const data = snap.data();
        const updatedAtMs = timestampToMillis(data.updatedAt);

        // TTL（最終更新から 30 日経過）チェック
        if (updatedAtMs > 0 && Date.now() - updatedAtMs > TTL_MS) {
          toastRef.current.warning('セッションの有効期限（最終アクセスから1か月）が切れました');
          const currentSession = useSessionStore.getState().session;
          const currentUser = useSessionStore.getState().currentUser;
          const isCreator = currentSession?.createdBy === currentUser;
          if (isCreator) {
            void import('../services/sessionService').then(({ deleteSession }) => {
              deleteSession(sessionId).catch((err) => {
                console.error('[FirebaseSync] Failed to delete expired session:', err);
              });
            });
          }
          useSessionStore.getState().clearSession();
          setTimeout(() => navigateRef.current('/'), 2000);
          return;
        }

        const gameState = data.gameState as GameState | undefined;
        if (!gameState) {
          // gameState 未初期化（セッション作成直後など）でも loaded と見なす
          useSyncStatusStore.getState().setGameStateLoaded(true);
          return;
        }

        // 試合開始通知（前後比較）— setState 前に oldCourts を撮る
        const oldCourts = useGameStore.getState().courts;
        if (gameState.courts !== undefined) {
          checkMatchStartNotifications(oldCourts, gameState.courts);
        }

        // 直接 setState（merge なし）。フィールドが remote に欠損している場合は
        // ローカルを触らない（古い document が新フィールドを空で上書きするのを防ぐ）。
        if (gameState.players !== undefined) {
          usePlayerStore.setState({ players: gameState.players });
        }
        const gameUpdates: Partial<{ courts: typeof gameState.courts; matchHistory: typeof gameState.matchHistory }> = {};
        if (gameState.courts !== undefined) gameUpdates.courts = gameState.courts;
        if (gameState.matchHistory !== undefined) gameUpdates.matchHistory = gameState.matchHistory;
        if (Object.keys(gameUpdates).length > 0) {
          useGameStore.setState(gameUpdates);
        }
        if (gameState.reservations !== undefined) {
          useReservationStore.setState({ reservations: gameState.reservations });
        }

        // 同期対象の設定フィールドのみ反映（端末ローカル設定は触らない）。
        // setPracticeType は副作用付き（'単'→prioritizeDiversity:false, '楽'→true）なので
        // 必ず action 経由で呼ぶ。recordScores / continuousMatchMode は副作用なしだが
        // 一貫性のため同様に action 経由に統一。
        if (gameState.settings) {
          const s = useSettingsStore.getState();
          if (
            gameState.settings.recordScores !== undefined &&
            gameState.settings.recordScores !== s.recordScores
          ) {
            s.setRecordScores(gameState.settings.recordScores);
          }
          if (
            gameState.settings.continuousMatchMode !== undefined &&
            gameState.settings.continuousMatchMode !== s.continuousMatchMode
          ) {
            s.setContinuousMatchMode(gameState.settings.continuousMatchMode);
          }
          if (
            gameState.settings.practiceType !== undefined &&
            gameState.settings.practiceType !== s.practiceType
          ) {
            s.setPracticeType(gameState.settings.practiceType);
          }
        }

        useSyncStatusStore.getState().setGameStateLoaded(true);
      },
      (error) => {
        console.error('[FirebaseSync] GameState subscription error:', error);
      },
    );

    return () => {
      unsub();
      useSyncStatusStore.getState().setGameStateLoaded(false);
      // 通知済みセットはセッション切替時にクリア（新セッションでは再通知してよい）
      notifiedMatches.clear();
    };
  }, [sessionId]);
}

/** 自分がメンバーのコートで試合が新規開始されたら通知を出す */
function checkMatchStartNotifications(oldCourts: Court[], newCourts: Court[]) {
  const currentUser = useSessionStore.getState().currentUser;
  if (!currentUser) return;

  const players = usePlayerStore.getState().players;
  const myPlayer = players.find((p) => p.name === currentUser);
  if (!myPlayer) return;

  const { matchHistory } = useGameStore.getState();

  for (const newCourt of newCourts) {
    const oldCourt = oldCourts.find((c) => c.id === newCourt.id);
    const justStarted = newCourt.isPlaying && (!oldCourt || !oldCourt.isPlaying);
    if (!justStarted) continue;

    const matchKey = `${newCourt.id}-${newCourt.startedAt}`;
    if (notifiedMatches.has(matchKey)) continue;

    const allPlayerIds = [...newCourt.teamA, ...newCourt.teamB];
    if (!allPlayerIds.includes(myPlayer.id)) continue;

    // 開始から 2 分以上経過していれば通知しない（リロード時の誤通知防止）
    const timeSinceStart = newCourt.startedAt ? Date.now() - newCourt.startedAt : 0;
    if (timeSinceStart > 120_000) continue;

    const finishedBefore = matchHistory.filter(
      (m) => m.finishedAt && newCourt.startedAt && m.finishedAt <= newCourt.startedAt,
    ).length;
    const playingBefore = newCourts.filter((c) => c.isPlaying && c.id < newCourt.id).length;
    const matchNumber = finishedBefore + playingBefore + 1;

    const teamANames = newCourt.teamA.map((id) => players.find((p) => p.id === id)?.name ?? '');
    const teamBNames = newCourt.teamB.map((id) => players.find((p) => p.id === id)?.name ?? '');

    notifyMatchStart(
      newCourt.id,
      matchNumber,
      teamANames,
      teamBNames,
      newCourt.startedAt ?? undefined,
    );
    notifiedMatches.add(matchKey);
  }
}
