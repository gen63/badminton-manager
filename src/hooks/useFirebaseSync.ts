import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useReservationStore } from '../stores/reservationStore';
import { useSessionStore } from '../stores/sessionStore';
import { doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { onSnapshot } from 'firebase/firestore';
import { syncGameStateWithTransaction, type GameState } from '../services/sessionService';
import { notifyMatchStart } from '../lib/notifications';
import { useToast } from './useToast';
import { getTimestampMillis, hashGameState, shouldApplyRemoteData } from '../lib/syncUtils';
import type { Court } from '../types/court';

/**
 * Firebase双方向同期フック
 *
 * 全参加者がFirestoreのゲーム状態をリアルタイムで受信し、
 * ローカルの変更も即座にFirestoreにpushする（双方向同期）
 *
 * Transaction使用により、同時更新時の競合を自動で解決します。
 * データハッシュ比較により、自分がpushしたデータを無視します。
 *
 * @returns prepareDirectTransaction / completeDirectTransaction
 *          外部から直接Transactionを実行する場合に使用（finishGameTransaction等）
 */
export function useFirebaseSync() {
  const session = useSessionStore((s) => s.session);
  const sessionId = session?.id;
  const isShared = !!session?.createdBy;
  const toast = useToast();
  const navigate = useNavigate();

  const isSyncingFromRemote = useRef(false);
  const lastPushedHash = useRef<string>('');
  const lastPushedTime = useRef<number>(0);
  const lastAppliedRemoteUpdatedAt = useRef<number>(0);
  const sessionDeletedNotified = useRef(false);
  const pushTimer = useRef<number | null>(null);
  
  // toast と navigate を ref で保持（依存配列の安定化）
  const toastRef = useRef(toast);
  const navigateRef = useRef(navigate);
  
  // ref更新はuseEffectで行う（render中の更新はNG）
  useEffect(() => {
    toastRef.current = toast;
    navigateRef.current = navigate;
  }, [toast, navigate]);

  const pushGameState = useCallback((sid: string) => {
    const { players } = usePlayerStore.getState();
    const { courts, matchHistory } = useGameStore.getState();
    const { reservations } = useReservationStore.getState();
    
    const gameState = { players, courts, matchHistory, reservations };
    const hash = hashGameState(gameState);
    
    // push開始時にタイムスタンプを記録（ローカルクライアント時刻、完了を待たない）
    const pushStartTime = Date.now();
    lastPushedTime.current = pushStartTime;
    
    syncGameStateWithTransaction(sid, gameState)
      .then(() => {
        lastPushedHash.current = hash;
      })
      .catch((err) => {
        // push失敗時はタイムスタンプをリセット（pullを受け付ける）
        lastPushedTime.current = 0;
        
        if (err?.code === 'conflict') {
          // 競合検出（Transactionが最大5回リトライした後に失敗）
          console.warn('[FirebaseSync] Conflict detected:', err);
          toastRef.current.warning('他のユーザーが更新しました。もう一度お試しください');
        } else {
          console.error('[FirebaseSync] Push failed:', err);
        }
      });
  }, []); // 依存なし: refとgetState()のみ使用、再生成不要

  // pushGameStateをrefで保持（依存配列の安定化）
  const pushGameStateRef = useRef(pushGameState);
  
  // ref更新はuseEffectで行う（render中の更新はNG）
  useEffect(() => {
    pushGameStateRef.current = pushGameState;
  }, [pushGameState]);
  
  // デバウンス付きpush：300ms以内の連続変更をまとめる
  const schedulePush = useCallback((sid: string) => {
    if (pushTimer.current) {
      clearTimeout(pushTimer.current);
    }
    pushTimer.current = setTimeout(() => {
      pushGameStateRef.current(sid);
      pushTimer.current = null;
    }, 300) as unknown as number;
  }, []); // 依存配列を空にして安定化

  // リモートデータを適用する処理（デバウンス後に実行）
  const applyRemoteData = useCallback((gameState: GameState, data: { updatedAt: unknown }) => {
    // リモートの更新時刻を取得（堅牢版）
    const remoteUpdatedAt = getTimestampMillis(data.updatedAt);
    
    // タイムスタンプ取得失敗時はエラーログを出して中断
    if (remoteUpdatedAt === null) {
      console.error('[FirebaseSync] ❌ Failed to parse updatedAt:', {
        raw: data.updatedAt,
        type: typeof data.updatedAt,
      });
      return;
    }

    // 受信したデータのハッシュを計算
    const incomingHash = hashGameState(gameState);
    
    // 適用すべきか判定
    const decision = shouldApplyRemoteData({
      incomingHash,
      lastPushedHash: lastPushedHash.current,
      remoteUpdatedAt,
      lastAppliedRemoteUpdatedAt: lastAppliedRemoteUpdatedAt.current,
      lastPushedTime: lastPushedTime.current,
      currentTime: Date.now(),
      pushBlockMs: 500,
    });

    if (!decision.shouldApply) {
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

    // 適用したリモートデータの更新時刻を記録
    lastAppliedRemoteUpdatedAt.current = remoteUpdatedAt;

    // ストア更新が完全に反映されるまで少し待ってからフラグをリセット
    // (setStateは同期的だが、subscribeコールバックは非同期的に呼ばれる可能性がある)
    setTimeout(() => {
      isSyncingFromRemote.current = false;
    }, 100);
  }, []); // 依存なし: refとgetState()のみ使用、再生成不要

  // ローカル変更をFirestoreに即座にpush
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

    // 初回push（セッション作成者のみ）
    // 参加者は初回pushをスキップ（リモートデータをpullして初期化）
    const { players } = usePlayerStore.getState();
    const currentUser = useSessionStore.getState().currentUser;
    const currentSession = useSessionStore.getState().session;
    const isCreator = currentSession?.createdBy === currentUser;
    
    // 作成者、またはプレイヤーが既にいる場合（ページリロード等）のみpush
    if (isCreator || (players && players.length > 0)) {
      pushGameStateRef.current(sessionId);
    }

    return () => {
      unsubPlayers();
      unsubGame();
      unsubReservations();
      if (pushTimer.current) {
        clearTimeout(pushTimer.current);
      }
    };
  }, [isShared, sessionId, schedulePush]); // schedulePushを依存配列に追加

  // Firestoreからpull（リアルタイム監視）
  useEffect(() => {
    if (!isShared || !sessionId || !db) return;

    const unsub = onSnapshot(
      doc(db, 'sessions', sessionId),
      (snap) => {
        // セッションが削除された場合
        if (!snap.exists()) {
          if (!sessionDeletedNotified.current) {
            sessionDeletedNotified.current = true;
            toastRef.current.error('セッションが削除されました');
            // セッション情報をクリア
            useSessionStore.getState().clearSession();
            // トップページに戻る
            setTimeout(() => navigateRef.current('/'), 1000);
          }
          return;
        }

        const data = snap.data();
        
        // 5日間経過判定（最終アクセスから5日 = 432000000ms）
        const updatedAt = typeof data.updatedAt === 'number'
          ? data.updatedAt
          : (data.updatedAt as { seconds?: number })?.seconds ? (data.updatedAt as { seconds: number }).seconds * 1000 : 0;

        const now = Date.now();
        const age = now - updatedAt;
        const TTL = 5 * 24 * 60 * 60 * 1000; // 5日間（120時間）

        if (updatedAt > 0 && age > TTL) {
          toastRef.current.warning('セッションの有効期限（最終アクセスから5日間）が切れました');
          
          // セッション削除（作成者のみ）
          const currentSession = useSessionStore.getState().session;
          const currentUser = useSessionStore.getState().currentUser;
          const isCreator = currentSession?.createdBy === currentUser;
          
          if (isCreator) {
            // 作成者がセッションを削除
            import('../services/sessionService').then(({ deleteSession }) => {
              deleteSession(sessionId).catch((err) => {
                console.error('[FirebaseSync] Failed to delete expired session:', err);
              });
            });
          }
          
          // ローカルセッションをクリア
          useSessionStore.getState().clearSession();
          // トップページに戻る
          setTimeout(() => navigateRef.current('/'), 2000);
          return;
        }

        const gameState = data.gameState as typeof data.gameState & { players: unknown[]; courts: unknown[]; matchHistory: unknown[]; reservations: unknown[] } | undefined;
        
        if (!gameState) return;

        // デバウンスなし：即座に判定・適用
        applyRemoteData(gameState, data as { updatedAt: unknown });
      },
      (error) => {
        console.error('GameState subscription error:', error);
      }
    );

    return unsub;
  }, [isShared, sessionId, applyRemoteData]); // applyRemoteDataを依存配列に追加

  /**
   * 外部から直接Transactionを実行する前に呼ぶ。
   * - pending pushをキャンセル
   * - isSyncingFromRemote=true でストア変更によるpushを抑止
   *
   * 楽観的ローカル更新 → finishGameTransaction の順で使う。
   */
  const prepareDirectTransaction = useCallback(() => {
    if (pushTimer.current) {
      clearTimeout(pushTimer.current);
      pushTimer.current = null;
    }
    isSyncingFromRemote.current = true;
  }, []);

  /**
   * 外部Transactionの完了後に呼ぶ（成功・already_finished 共通）。
   * - lastPushedHash/Time をリセットして次の onSnapshot を受け入れ可能にする
   * - isSyncingFromRemote=false にしてpull適用を許可
   *
   * Transaction成功時: onSnapshot でリモート状態が届き、ローカルの楽観的更新が修正される
   * already_finished時: 他ユーザーの結果が onSnapshot で届き、ローカルが正しい状態に上書きされる
   */
  const completeDirectTransaction = useCallback(() => {
    if (pushTimer.current) {
      clearTimeout(pushTimer.current);
      pushTimer.current = null;
    }
    // ハッシュとタイムスタンプをリセットして、次の onSnapshot を確実に適用
    lastPushedHash.current = '';
    lastPushedTime.current = 0;
    isSyncingFromRemote.current = false;
  }, []);

  return { prepareDirectTransaction, completeDirectTransaction };
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
      continue;
    }

    // 自分がこのコートにいるか
    const allPlayerIds = [...newCourt.teamA, ...newCourt.teamB];
    if (allPlayerIds.includes(myPlayer.id)) {
      // 2分以上経過している場合は通知しない
      const now = Date.now();
      const timeSinceStart = newCourt.startedAt ? now - newCourt.startedAt : 0;
      if (timeSinceStart > 120000) { // 120秒 = 2分
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
