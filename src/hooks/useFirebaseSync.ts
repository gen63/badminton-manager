import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useReservationStore } from '../stores/reservationStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { onSnapshot } from 'firebase/firestore';
import { syncGameStateWithTransaction, type GameState } from '../services/sessionService';
import { notifyMatchStart } from '../lib/notifications';
import { useToast } from './useToast';
import { getTimestampMillis, hashGameState, mergeGameState, shouldApplyRemoteData, type SyncGameState } from '../lib/syncUtils';
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
/** sessionStorageキー */
const syncBaseKey = (sessionId: string) => `sync_base_${sessionId}`;

/** lastSyncedState をsessionStorageに保存（ページ遷移を跨いで保持） */
function saveSyncBase(sessionId: string, state: GameState): void {
  try {
    sessionStorage.setItem(syncBaseKey(sessionId), JSON.stringify(state));
  } catch {
    // sessionStorageが使えない場合（プライベートブラウジング等）は無視
  }
}

/** sessionStorageからlastSyncedStateを復元 */
function loadSyncBase(sessionId: string): GameState | null {
  try {
    const raw = sessionStorage.getItem(syncBaseKey(sessionId));
    return raw ? (JSON.parse(raw) as GameState) : null;
  } catch {
    return null;
  }
}

/** 全ストアから現在のGameStateを構築 */
function getCurrentGameState(): GameState {
  const { players } = usePlayerStore.getState();
  const { courts, matchHistory } = useGameStore.getState();
  const { reservations } = useReservationStore.getState();
  const { recordScores, continuousMatchMode, practiceType } = useSettingsStore.getState();
  return {
    players, courts, matchHistory, reservations,
    settings: { recordScores, continuousMatchMode, practiceType },
  };
}

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
  const lastSyncedState = useRef<GameState | null>(null);
  const pushInFlight = useRef<Promise<void> | null>(null);
  const blockedUpdate = useRef<{ gameState: GameState; data: { updatedAt: unknown } } | null>(null);
  const retryTimer = useRef<number | null>(null);

  // toast / navigate / sessionId を ref で保持（依存配列の安定化）
  const toastRef = useRef(toast);
  const navigateRef = useRef(navigate);
  const sessionIdRef = useRef(sessionId);

  // ref更新はuseEffectで行う（render中の更新はNG）
  useEffect(() => {
    toastRef.current = toast;
    navigateRef.current = navigate;
    sessionIdRef.current = sessionId;
  }, [toast, navigate, sessionId]);

  const pushGameState = useCallback((sid: string) => {
    const doPush = async () => {
      // フレッシュな状態を取得（前のpush完了後に呼ばれるので最新）
      const gameState = getCurrentGameState();

      // push開始時にタイムスタンプを記録
      lastPushedTime.current = Date.now();

      const mergedState = await syncGameStateWithTransaction(sid, gameState, lastSyncedState.current);
      lastPushedHash.current = hashGameState(mergedState);
      lastSyncedState.current = mergedState;
      // ページ遷移後もbaseを保持（/playersでの削除が/main再訪時に復活するバグを防止）
      saveSyncBase(sid, mergedState);
    };

    // Promise chainingで直列化（前のpush完了を待ってから次を実行）
    pushInFlight.current = (pushInFlight.current || Promise.resolve())
      .then(() => doPush())
      .catch((err) => {
        if (err?.code === 'conflict') {
          // 競合時は guard を維持: 次の onSnapshot で 3-way マージが正しく解決するため、
          // guard をリセットして「自分の push と同じ」スキップ判定を弱めるとローカルの
          // 楽観的更新が短時間で巻き戻る原因になる。
          console.warn('[FirebaseSync] Conflict detected:', err);
          toastRef.current.warning('他のユーザーが更新しました。もう一度お試しください');
        } else {
          // ネットワーク失敗等: ハッシュをクリアして次の snapshot を受け入れ可能にする
          // （guard 維持のままだと永久にローカル状態が反映されないため）
          console.error('[FirebaseSync] Push failed:', err);
          lastPushedHash.current = '';
          lastPushedTime.current = 0;
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
      // 自分がpushしたデータと同じためスキップする場合でも更新時刻を記録する。
      // これにより、blockedUpdateのリトライが古いデータを「新しい」と誤判定して
      // 適用するのを防ぐ（メンバー削除の復活・支払い情報の上書きを防止）
      if (decision.reason === 'same as last push' && remoteUpdatedAt > lastAppliedRemoteUpdatedAt.current) {
        lastAppliedRemoteUpdatedAt.current = remoteUpdatedAt;
      }
      // pushBlockMs によるブロックの場合: ブロック期間後に再適用をスケジュール
      // onSnapshot は再発火しないため、ブロックしたままでは永久にデータが届かなくなる
      if (decision.reason?.startsWith('too soon after push')) {
        const pushTimeAtBlock = lastPushedTime.current;
        const timeSinceLastPush = Date.now() - pushTimeAtBlock;
        const remaining = Math.max(0, 500 - timeSinceLastPush) + 50;

        if (retryTimer.current) clearTimeout(retryTimer.current);
        blockedUpdate.current = { gameState, data };

        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          if (!blockedUpdate.current) return;
          // ブロック後に新しい push があれば skip（次の push の3-wayマージで自動解消）
          if (lastPushedTime.current !== pushTimeAtBlock) {
            blockedUpdate.current = null;
            return;
          }
          const { gameState: gs, data: d } = blockedUpdate.current;
          blockedUpdate.current = null;
          applyRemoteData(gs, d);
        }, remaining) as unknown as number;
      }
      return;
    }

    // 正常適用: pending retry をキャンセル（より新しい更新が通過したため）
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    blockedUpdate.current = null;

    isSyncingFromRemote.current = true;

    // 3-way マージ: ローカルの未push変更を保護したうえでリモート変更を取り込む
    // base が無い（初回 pull）の場合は remote をそのまま採用する
    const localState = getCurrentGameState();
    const baseState = lastSyncedState.current;
    const merged = baseState
      ? mergeGameState(
          baseState as unknown as SyncGameState,
          localState as unknown as SyncGameState,
          gameState as unknown as SyncGameState,
        ) as unknown as GameState
      : gameState;

    // プレイヤーストアを更新
    if (JSON.stringify(localState.players) !== JSON.stringify(merged.players)) {
      usePlayerStore.setState({ players: merged.players });
    }

    // ゲームストアを更新
    const gameUpdates: Record<string, unknown> = {};
    if (JSON.stringify(localState.courts) !== JSON.stringify(merged.courts)) {
      // 試合開始通知: コートが isPlaying: false → true に変わった場合
      checkMatchStartNotifications(localState.courts, merged.courts);
      gameUpdates.courts = merged.courts;
    }
    if (JSON.stringify(localState.matchHistory) !== JSON.stringify(merged.matchHistory)) {
      gameUpdates.matchHistory = merged.matchHistory;
    }
    if (Object.keys(gameUpdates).length > 0) {
      useGameStore.setState(gameUpdates as { courts: typeof merged.courts; matchHistory: typeof merged.matchHistory });
    }

    // 予約ストアを更新
    if (merged.reservations && JSON.stringify(localState.reservations) !== JSON.stringify(merged.reservations)) {
      useReservationStore.setState({ reservations: merged.reservations });
    }

    // セッションレベル設定を更新
    // ユーザーがローカルで変更したばかりの設定は上書きしない（push 完了前に remote が
    // 到着した場合、remote は古い値を持っており、ユーザーの変更が消えてしまうため）
    if (gameState.settings) {
      const settings = useSettingsStore.getState();
      const baseSettings = lastSyncedState.current?.settings;
      const localUnchanged = <K extends keyof NonNullable<GameState['settings']>>(key: K): boolean =>
        !baseSettings || baseSettings[key] === settings[key];

      if (
        gameState.settings.recordScores !== undefined &&
        gameState.settings.recordScores !== settings.recordScores &&
        localUnchanged('recordScores')
      ) {
        useSettingsStore.getState().setRecordScores(gameState.settings.recordScores);
      }
      if (
        gameState.settings.continuousMatchMode !== undefined &&
        gameState.settings.continuousMatchMode !== settings.continuousMatchMode &&
        localUnchanged('continuousMatchMode')
      ) {
        useSettingsStore.getState().setContinuousMatchMode(gameState.settings.continuousMatchMode);
      }
      if (
        gameState.settings.practiceType !== undefined &&
        gameState.settings.practiceType !== settings.practiceType &&
        localUnchanged('practiceType')
      ) {
        useSettingsStore.getState().setPracticeType(gameState.settings.practiceType);
      }
    }

    // 適用したリモートデータの更新時刻を記録
    lastAppliedRemoteUpdatedAt.current = remoteUpdatedAt;

    // lastSyncedStateを更新（次のpushで3-wayマージのbaseとして使用）
    lastSyncedState.current = gameState;
    if (sessionIdRef.current) saveSyncBase(sessionIdRef.current, gameState);

    // Zustand setStateとsubscribeコールバックはともに同期的。
    // ストア更新→subscribe発火→isSyncingFromRemoteチェック の順で同期的に完了するため、
    // ここで即座にフラグをリセットしても安全。
    isSyncingFromRemote.current = false;
  }, []); // 依存なし: refとgetState()のみ使用、再生成不要

  // ローカル変更をFirestoreに即座にpush
  useEffect(() => {
    if (!isShared || !sessionId) return;

    // lastSyncedStateを初期化
    // sessionStorageに前回の同期ベースが保存されている場合はそちらを使用する。
    // （/playersでメンバー削除 → /mainに戻った際、削除が「リモート追加」と誤判定されて
    //   復活するバグを防ぐため、ページ遷移を跨いでbaseを保持する）
    if (!lastSyncedState.current) {
      const saved = loadSyncBase(sessionId);
      lastSyncedState.current = saved ?? getCurrentGameState();
    }

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

    const unsubSettings = useSettingsStore.subscribe(() => {
      if (isSyncingFromRemote.current) return;
      schedulePush(sessionId);
    });

    // 初回push（セッション作成者のみ）
    // 参加者・リロード時は onSnapshot で最新データを受け取るだけでよい
    // （players.length > 0 条件を削除: null baseで古いデータを上書きするバグを修正）
    const currentUser = useSessionStore.getState().currentUser;
    const currentSession = useSessionStore.getState().session;
    const isCreator = currentSession?.createdBy === currentUser;

    if (isCreator) {
      pushGameStateRef.current(sessionId);
    }

    return () => {
      unsubPlayers();
      unsubGame();
      unsubReservations();
      unsubSettings();
      if (pushTimer.current) {
        clearTimeout(pushTimer.current);
        pushTimer.current = null;
      }
      // セッション切替時にin-flightのpushチェーンを断ち切る
      pushInFlight.current = null;
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
        
        // 1か月経過判定（最終アクセスから30日 = 2592000000ms）
        const updatedAt = typeof data.updatedAt === 'number'
          ? data.updatedAt
          : (data.updatedAt as { seconds?: number })?.seconds ? (data.updatedAt as { seconds: number }).seconds * 1000 : 0;

        const now = Date.now();
        const age = now - updatedAt;
        const TTL = 30 * 24 * 60 * 60 * 1000; // 30日間（720時間）

        if (updatedAt > 0 && age > TTL) {
          toastRef.current.warning('セッションの有効期限（最終アクセスから1か月）が切れました');
          
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

    return () => {
      unsub();
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
    };
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
  const completeDirectTransaction = useCallback((writtenState?: GameState) => {
    if (pushTimer.current) {
      clearTimeout(pushTimer.current);
      pushTimer.current = null;
    }
    // ハッシュとタイムスタンプをリセットして、次の onSnapshot を確実に適用
    lastPushedHash.current = '';
    lastPushedTime.current = 0;

    // writtenStateが渡された場合はそれを使用（トランザクションが実際に書き込んだ状態）
    // 渡されない場合はローカル状態から取得（フォールバック）
    const newBase = writtenState || getCurrentGameState();
    lastSyncedState.current = newBase;
    if (sessionId) saveSyncBase(sessionId, newBase);

    isSyncingFromRemote.current = false;
  }, [sessionId]);

  /**
   * デバウンスをスキップして即座に push を直列実行する。
   *
   * `prepareDirectTransaction` でガードしたうえでローカル状態を変更し、
   * その確定をその場で push したいケース（コート増減等）で使用する。
   * 内部の push チェーンに乗せるので他の push と直列化される。
   *
   * 失敗（competing更新による conflict 等）は呼び出し側に reject として伝えるが、
   * 内部の `pushInFlight` チェーンは常に resolve させて後続 push を阻害しない。
   *
   * @returns 書き込み（3-wayマージ）後の GameState、未設定セッションでは null
   */
  const pushImmediate = useCallback(async (): Promise<GameState | null> => {
    const sid = sessionIdRef.current;
    if (!sid) return null;

    if (pushTimer.current) {
      clearTimeout(pushTimer.current);
      pushTimer.current = null;
    }

    const result = (pushInFlight.current || Promise.resolve()).then(async () => {
      const gameState = getCurrentGameState();
      lastPushedTime.current = Date.now();
      const written = await syncGameStateWithTransaction(sid, gameState, lastSyncedState.current);
      lastPushedHash.current = hashGameState(written);
      lastSyncedState.current = written;
      saveSyncBase(sid, written);
      return written;
    });

    // 後続 push のためにチェーンは常に resolve させる
    pushInFlight.current = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }, []);

  return { prepareDirectTransaction, completeDirectTransaction, pushImmediate };
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
