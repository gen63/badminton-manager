import { useEffect, useRef, useCallback } from 'react';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useReservationStore } from '../stores/reservationStore';
import { useSessionStore } from '../stores/sessionStore';
import { syncGameStateWithTransaction, subscribeToGameState } from '../services/sessionService';
import { notifyMatchStart } from '../lib/notifications';
import { useToast } from './useToast';
import type { Court } from '../types/court';

/**
 * Firebase双方向同期フック
 *
 * 全参加者がFirestoreのゲーム状態をリアルタイムで受信し、
 * ローカルの変更もFirestoreにpushする（双方向同期）
 * 
 * Transaction使用により、同時更新時の競合を自動で解決します。
 */
export function useFirebaseSync() {
  const session = useSessionStore((s) => s.session);
  const sessionId = session?.id;
  const isShared = !!session?.createdBy;
  const toast = useToast();

  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSyncingFromRemote = useRef(false);
  const lastPushTime = useRef<number>(0);

  const pushGameState = useCallback((sid: string) => {
    const { players } = usePlayerStore.getState();
    const { courts, matchHistory } = useGameStore.getState();
    const { reservations } = useReservationStore.getState();
    
    syncGameStateWithTransaction(sid, { players, courts, matchHistory, reservations })
      .then(() => {
        // push成功時、タイムスタンプを記録（1秒間はpullを無視）
        lastPushTime.current = Date.now();
      })
      .catch((err) => {
        if (err?.code === 'conflict') {
          // 競合検出（Transactionが最大5回リトライした後に失敗）
          toast.warning('他のユーザーが更新しました。もう一度お試しください');
        } else {
          console.error('Failed to sync game state:', err);
        }
      });
  }, [toast]);

  const schedulePush = useCallback((sid: string) => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      pushGameState(sid);
    }, 300); // 300msデバウンス（高速化）
  }, [pushGameState]);

  // ローカル変更をFirestoreにpush（デバウンス）
  useEffect(() => {
    if (!isShared || !sessionId) return;

    const unsubPlayers = usePlayerStore.subscribe(() => {
      if (isSyncingFromRemote.current) return;
      schedulePush(sessionId);
    });

    const unsubGame = useGameStore.subscribe(() => {
      if (isSyncingFromRemote.current) return;
      schedulePush(sessionId);
    });

    const unsubReservations = useReservationStore.subscribe(() => {
      if (isSyncingFromRemote.current) return;
      schedulePush(sessionId);
    });

    // 初回push
    pushGameState(sessionId);

    return () => {
      unsubPlayers();
      unsubGame();
      unsubReservations();
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [isShared, sessionId, schedulePush, pushGameState]);

  // Firestoreからpull（リアルタイム監視）
  useEffect(() => {
    if (!isShared || !sessionId) return;

    const unsub = subscribeToGameState(sessionId, (gameState) => {
      if (!gameState) return;

      // push直後1000ms間はpullを無視（自分の変更が反映されるのを待つ）
      const timeSinceLastPush = Date.now() - lastPushTime.current;
      if (timeSinceLastPush < 1000) {
        console.log('[FirebaseSync] Ignoring pull (recently pushed)');
        return;
      }

      isSyncingFromRemote.current = true;

      // プレイヤーストアを更新
      const { players } = usePlayerStore.getState();
      if (JSON.stringify(players) !== JSON.stringify(gameState.players)) {
        usePlayerStore.setState({ players: gameState.players });
      }

      // ゲームストアを更新
      const { courts, matchHistory } = useGameStore.getState();
      const gameUpdates: Record<string, unknown> = {};
      if (JSON.stringify(courts) !== JSON.stringify(gameState.courts)) {
        // 試合開始通知: コートが isPlaying: false → true に変わった場合
        checkMatchStartNotifications(courts, gameState.courts);
        gameUpdates.courts = gameState.courts;
      }
      if (JSON.stringify(matchHistory) !== JSON.stringify(gameState.matchHistory)) {
        gameUpdates.matchHistory = gameState.matchHistory;
      }
      if (Object.keys(gameUpdates).length > 0) {
        useGameStore.setState(gameUpdates as { courts: typeof courts; matchHistory: typeof matchHistory });
      }

      // 予約ストアを更新
      const { reservations } = useReservationStore.getState();
      if (gameState.reservations && JSON.stringify(reservations) !== JSON.stringify(gameState.reservations)) {
        useReservationStore.setState({ reservations: gameState.reservations });
      }

      isSyncingFromRemote.current = false;
    });

    return unsub;
  }, [isShared, sessionId]);
}

// 通知済みの試合を記録（重複防止）
const notifiedMatches = new Set<string>();

/** 試合開始を検知して通知を送る */
function checkMatchStartNotifications(oldCourts: Court[], newCourts: Court[]) {
  const currentUser = useSessionStore.getState().currentUser;
  if (!currentUser) return;

  // currentUserの名前からプレイヤーIDを取得
  const players = usePlayerStore.getState().players;
  const myPlayer = players.find((p) => p.name === currentUser);
  if (!myPlayer) return;

  const { matchHistory } = useGameStore.getState();

  for (const newCourt of newCourts) {
    const oldCourt = oldCourts.find((c) => c.id === newCourt.id);

    // isPlaying: false → true に変わった（試合開始）
    const justStarted = newCourt.isPlaying && (!oldCourt || !oldCourt.isPlaying);
    if (!justStarted) continue;

    // 既に通知済みか確認（startedAtをキーにする）
    const matchKey = `${newCourt.id}-${newCourt.startedAt}`;
    if (notifiedMatches.has(matchKey)) {
      console.log('[Notification] Already notified:', matchKey);
      continue;
    }

    // 自分がこのコートにいるか
    const allPlayerIds = [...newCourt.teamA, ...newCourt.teamB];
    if (allPlayerIds.includes(myPlayer.id)) {
      // 2分以上経過している場合は通知しない
      const now = Date.now();
      const timeSinceStart = newCourt.startedAt ? now - newCourt.startedAt : 0;
      if (timeSinceStart > 120000) { // 120秒 = 2分
        console.log('[Notification] Skipped: match started more than 2 minutes ago');
        continue;
      }

      // 試合番号を計算（終了済み試合 + 現在プレイ中でIDが小さいコート + 1）
      const finishedBefore = matchHistory.filter(
        m => m.finishedAt && newCourt.startedAt && m.finishedAt <= newCourt.startedAt
      ).length;
      const playingBefore = newCourts.filter(
        c => c.isPlaying && c.id < newCourt.id
      ).length;
      const matchNumber = finishedBefore + playingBefore + 1;

      // プレイヤーIDから名前を取得
      const teamANames = newCourt.teamA.map(id => {
        const player = players.find(p => p.id === id);
        return player?.name || '';
      });
      const teamBNames = newCourt.teamB.map(id => {
        const player = players.find(p => p.id === id);
        return player?.name || '';
      });
      
      notifyMatchStart(newCourt.id, matchNumber, teamANames, teamBNames, newCourt.startedAt ?? undefined);
      
      // 通知済みとして記録
      notifiedMatches.add(matchKey);
    }
  }
}
