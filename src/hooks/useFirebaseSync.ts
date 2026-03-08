import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useReservationStore } from '../stores/reservationStore';
import { useSessionStore } from '../stores/sessionStore';
import { syncGameState, subscribeToGameState } from '../services/sessionService';
import { notifyMatchStart } from '../lib/notifications';
import type { Court } from '../types/court';

/**
 * Firebase双方向同期フック
 *
 * 全参加者がFirestoreのゲーム状態をリアルタイムで受信し、
 * ローカルの変更もFirestoreにpushする（双方向同期）
 */
export function useFirebaseSync() {
  const session = useSessionStore((s) => s.session);
  const sessionId = session?.id;
  const isShared = !!session?.createdBy;

  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSyncingFromRemote = useRef(false);

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
  }, [isShared, sessionId]);

  // Firestoreからpull（リアルタイム監視）
  useEffect(() => {
    if (!isShared || !sessionId) return;

    const unsub = subscribeToGameState(sessionId, (gameState) => {
      if (!gameState) return;

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

  function schedulePush(sid: string) {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      pushGameState(sid);
    }, 500); // 500msデバウンス
  }

  function pushGameState(sid: string) {
    const { players } = usePlayerStore.getState();
    const { courts, matchHistory } = useGameStore.getState();
    const { reservations } = useReservationStore.getState();
    syncGameState(sid, { players, courts, matchHistory, reservations }).catch((err) => {
      console.error('Failed to sync game state:', err);
    });
  }
}

/** 試合開始を検知して通知を送る */
function checkMatchStartNotifications(oldCourts: Court[], newCourts: Court[]) {
  const currentUser = useSessionStore.getState().currentUser;
  if (!currentUser) return;

  // currentUserの名前からプレイヤーIDを取得
  const players = usePlayerStore.getState().players;
  const myPlayer = players.find((p) => p.name === currentUser);
  if (!myPlayer) return;

  for (const newCourt of newCourts) {
    const oldCourt = oldCourts.find((c) => c.id === newCourt.id);

    // isPlaying: false → true に変わった（試合開始）
    const justStarted = newCourt.isPlaying && (!oldCourt || !oldCourt.isPlaying);
    if (!justStarted) continue;

    // 自分がこのコートにいるか
    const allPlayerIds = [...newCourt.teamA, ...newCourt.teamB];
    if (allPlayerIds.includes(myPlayer.id)) {
      notifyMatchStart(newCourt.id);
    }
  }
}
