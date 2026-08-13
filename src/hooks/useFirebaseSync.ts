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
import { DEFAULT_RESERVATION_BLOCK_THRESHOLD } from '../lib/algorithm';
import { useSyncStatusStore } from '../stores/syncStatusStore';
import { usePresenceStore } from '../stores/presenceStore';
import { notifyForcedRest } from '../lib/notifications';
import { unresolvedOpsOf } from '../services/sessionMutations';
import { useNoticeStore } from '../stores/noticeStore';
import type { Match } from '../types/match';
import type { Player } from '../types/player';
import type { GameState } from '../services/sessionService';
import type { Session } from '../types/session';

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** 未対応強制休憩通知の重複防止（プロセス全体で共有） */
const notifiedForcedRests = new Set<string>();

/** 結果未登録強制休憩通知の重複防止（プロセス全体で共有） */
const notifiedUnrecordedRests = new Set<string>();

/** 浅い参照差分があるかを JSON 比較で判定（H3 setState スキップ用） */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * visibility / online で再購読をキックする最短間隔。直近の再購読から
 * これより短い間隔で発火しても no-op。連続イベントでの過剰な再接続を防ぐ。
 */
const RESUBSCRIBE_THROTTLE_MS = 5_000;

/**
 * タブが hidden だった時間がこの値を超えた場合のみ visible 復帰時に再購読する。
 * 短時間 (< 1 分) の alt-tab では Firestore WebSocket が生きている可能性が高く、
 * 毎回再購読すると無駄なローディング点滅が起きるため。
 * syncError が立っている / hidden 中に長時間経過した場合は短時間でも再購読する。
 */
const HIDDEN_DURATION_FOR_RESUBSCRIBE_MS = 60_000;

export function useFirebaseSync() {
  const sessionId = useSessionStore((s) => s.session?.id);
  const reconnectNonce = useSyncStatusStore((s) => s.reconnectNonce);
  const navigate = useNavigate();

  // 依存配列の安定化
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  const sessionDeletedNotified = useRef(false);
  const lastResubscribeAtRef = useRef(0);

  useEffect(() => {
    if (!sessionId || !db) {
      // セッション未選択 / Firebase 未設定では「読み込み済み」扱い（待機する Firestore なし）
      useSyncStatusStore.getState().setGameStateLoaded(true);
      return;
    }

    sessionDeletedNotified.current = false;
    useSyncStatusStore.getState().setGameStateLoaded(false);
    useSyncStatusStore.getState().setSyncError(null);

    // マウント時に既に hidden の場合（PWA バックグラウンド起動等）は
    // その時刻を起点にする。visible なら 0。
    let hiddenSinceMs = document.visibilityState === 'hidden' ? Date.now() : 0;
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSinceMs = Date.now();
        return;
      }
      // visible 復帰
      const hiddenDuration = hiddenSinceMs > 0 ? Date.now() - hiddenSinceMs : 0;
      hiddenSinceMs = 0;
      // 短時間の alt-tab で毎回再接続するのは過剰なので、hidden 時間がしきい値を
      // 超えた場合 OR 既に syncError が立っている場合だけ再購読する。
      const hasError = useSyncStatusStore.getState().syncError !== null;
      if (!hasError && hiddenDuration < HIDDEN_DURATION_FOR_RESUBSCRIBE_MS) return;
      const now = Date.now();
      if (now - lastResubscribeAtRef.current < RESUBSCRIBE_THROTTLE_MS) return;
      lastResubscribeAtRef.current = now;
      // タブ復帰時に Firestore の WebSocket が stale な場合があるため再購読をキック。
      // useEffect の依存に reconnectNonce を入れているのでこれだけで unsub→sub が走る。
      useSyncStatusStore.getState().requestReconnect();
    };

    const handleOnline = () => {
      const now = Date.now();
      if (now - lastResubscribeAtRef.current < RESUBSCRIBE_THROTTLE_MS) return;
      lastResubscribeAtRef.current = now;
      useSyncStatusStore.getState().requestReconnect();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);

    const unsub = onSnapshot(
      doc(db, 'sessions', sessionId),
      (snap) => {
        // 再受信が成功したらエラーバナーをクリア（一時的な切断から回復した場合）
        if (useSyncStatusStore.getState().syncError) {
          useSyncStatusStore.getState().setSyncError(null);
        }
        // セッション削除
        if (!snap.exists()) {
          if (!sessionDeletedNotified.current) {
            sessionDeletedNotified.current = true;
            useSessionStore.getState().clearSession();
            // 即時 navigate（旧実装の setTimeout 待ちで /players 等が一瞬残ると、
            // session ガード無しページでフラッシュが起きるため）。
            // 切断理由は遷移先 SessionSelectPage が location.state.notice を見て表示する。
            navigateRef.current('/', {
              state: { notice: { type: 'error', message: 'セッションが削除されました' } },
            });
          }
          return;
        }

        const data = snap.data();
        const updatedAtMs = timestampToMillis(data.updatedAt);

        // === セッションレベルのフィールドを sessionStore に反映（H1: useRealtimeSession 統合） ===
        const information = data.information
          ? {
              ...(data.information as NonNullable<Session['information']>),
              readBy: (data.information as { readBy?: string[] }).readBy ?? [],
            }
          : undefined;
        useSessionStore.getState().updateSession({
          config: data.config as Session['config'],
          participants: data.participants as string[] | undefined,
          registeredPlayers: data.registeredPlayers as string[] | undefined,
          admins: data.admins as string[] | undefined,
          status: data.status as Session['status'],
          information,
          accounting: data.accounting as Session['accounting'],
        });
        // プレゼンス / 最終画面参照時刻は揮発ストアへ（1回のsetStateでまとめる）
        usePresenceStore.getState().setPresenceSnapshot({
          presence: (data.presence as Session['presence']) ?? {},
          lastSeen: (data.lastSeen as Session['lastSeen']) ?? {},
        });

        // TTL（最終更新から 30 日経過）チェック
        if (updatedAtMs > 0 && Date.now() - updatedAtMs > TTL_MS) {
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
          navigateRef.current('/', {
            state: {
              notice: {
                type: 'warning',
                message: 'セッションの有効期限（最終アクセスから1か月）が切れました',
              },
            },
          });
          return;
        }

        const gameState = data.gameState as GameState | undefined;
        if (!gameState) {
          // gameState 未初期化（セッション作成直後など）でも loaded と見なす
          useSyncStatusStore.getState().setGameStateLoaded(true);
          return;
        }

        // 未対応（会費・名簿）強制休憩の全員通知（実施端末以外もここで受け取る）
        if (gameState.players !== undefined) {
          checkForcedRestNotifications(gameState.players);
        }
        // 結果未登録試合による強制休憩の全員通知
        if (gameState.matchHistory !== undefined) {
          checkUnrecordedRestNotifications(
            gameState.matchHistory,
            gameState.players ?? usePlayerStore.getState().players,
          );
        }

        // 直接 setState（merge なし）。フィールドが remote に欠損している場合は
        // ローカルを触らない（古い document が新フィールドを空で上書きするのを防ぐ）。
        // 値が同じ場合は JSON 比較でスキップして無駄な再レンダーを抑止する（H3）。
        if (gameState.players !== undefined) {
          const cur = usePlayerStore.getState().players;
          if (!jsonEqual(cur, gameState.players)) {
            usePlayerStore.setState({ players: gameState.players });
          }
        }
        if (gameState.courts !== undefined || gameState.matchHistory !== undefined) {
          const curState = useGameStore.getState();
          const courtsChanged = gameState.courts !== undefined &&
            !jsonEqual(curState.courts, gameState.courts);
          const historyChanged = gameState.matchHistory !== undefined &&
            !jsonEqual(curState.matchHistory, gameState.matchHistory);
          if (courtsChanged || historyChanged) {
            useGameStore.setState({
              courts: courtsChanged ? gameState.courts! : curState.courts,
              matchHistory: historyChanged ? gameState.matchHistory! : curState.matchHistory,
            });
          }
        }
        if (gameState.reservations !== undefined) {
          const cur = useReservationStore.getState().reservations;
          if (!jsonEqual(cur, gameState.reservations)) {
            useReservationStore.setState({ reservations: gameState.reservations });
          }
        }

        // 同期対象の設定フィールドのみ反映（端末ローカル設定は触らない）。
        // setPracticeType は副作用付き（'単'→forceBulkAssignment:false, '楽'→true）なので
        // 必ず action 経由で呼ぶ。recordScores / continuousMatchMode は副作用なしだが
        // 一貫性のため同様に action 経由に統一。
        const s = useSettingsStore.getState();
        if (gameState.settings) {
          if (
            gameState.settings.recordScores !== undefined &&
            gameState.settings.recordScores !== s.recordScores
          ) {
            s.setRecordScores(gameState.settings.recordScores);
          }
          // continuousMatchMode は未設定なら false 扱い（finishMatchAndContinue の
          // `?? false` フォールバックと表示を一致させる。旧セッション互換）
          const remoteContinuous = gameState.settings.continuousMatchMode ?? false;
          if (remoteContinuous !== s.continuousMatchMode) {
            s.setContinuousMatchMode(remoteContinuous);
          }
          // useStayDurationPriority は未設定なら **true** 扱い（旧セッション互換。
          // assignCourts の `?? true` / settingsStore の初期値と揃える）。
          const remoteStayDuration = gameState.settings.useStayDurationPriority ?? true;
          if (remoteStayDuration !== s.useStayDurationPriority) {
            s.setUseStayDurationPriority(remoteStayDuration);
          }
          // forceBulkAssignment は未設定なら **true** 扱い（デフォルト ON。
          // settingsStore の初期値 / finishMatchAndContinue の `?? true` と揃える）。
          const remoteForceBulkAssignment = gameState.settings.forceBulkAssignment ?? true;
          if (remoteForceBulkAssignment !== s.forceBulkAssignment) {
            s.setForceBulkAssignment(remoteForceBulkAssignment);
          }
          // lateBalanceMode は未設定なら false 扱い（旧セッション互換）
          const remoteLateBalance = gameState.settings.lateBalanceMode ?? false;
          if (remoteLateBalance !== s.lateBalanceMode) {
            s.setLateBalanceMode(remoteLateBalance);
          }
          const remoteAutoFired = gameState.settings.lateBalanceAutoFired ?? false;
          if (remoteAutoFired !== s.lateBalanceAutoFired) {
            s.setLateBalanceAutoFired(remoteAutoFired);
          }
          // reservationBlockThreshold は未設定ならデフォルト扱い（旧セッション互換）
          const remoteRsvThreshold =
            gameState.settings.reservationBlockThreshold ?? DEFAULT_RESERVATION_BLOCK_THRESHOLD;
          if (remoteRsvThreshold !== s.reservationBlockThreshold) {
            s.setReservationBlockThreshold(remoteRsvThreshold);
          }
        }
        // practiceType 同期: gameState.settings.practiceType が未設定（旧セッション
        // 等）でも、前セッションから持ち越した端末ローカル値（特に '単'）が
        // gameMode として使われ続けるとダブルス練習でも assignCourts がシングルス
        // フローを走らせ、コート上に 2 人しか配置されない不具合になる。
        // 未設定時は config.gameMode から派生、それも無ければ '複' を採用して
        // セッション全員でモードを揃える。
        const remotePracticeType = gameState.settings?.practiceType;
        const desiredPracticeType: '単' | '複' | '楽' =
          remotePracticeType ??
          ((data.config as { gameMode?: 'singles' | 'doubles' } | undefined)?.gameMode ===
          'singles'
            ? '単'
            : '複');
        if (desiredPracticeType !== s.practiceType) {
          s.setPracticeType(desiredPracticeType);
        }

        useSyncStatusStore.getState().setGameStateLoaded(true);
      },
      (error) => {
        console.error('[FirebaseSync] GameState subscription error:', error);
        // ERR2: 永続バナーで同期切断を伝える（toast は消えてしまうため）
        const code = (error as { code?: string })?.code ?? 'unknown';
        const detail =
          code === 'permission-denied'
            ? '権限がありません'
            : code === 'unavailable'
            ? 'Firestore に接続できません'
            : '同期エラー';
        useSyncStatusStore.getState().setSyncError(`${detail} (${code})`);
      },
    );

    return () => {
      unsub();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
      useSyncStatusStore.getState().setGameStateLoaded(false);
      // 通知済みセットはセッション切替時にクリア（新セッションでは再通知してよい）
      notifiedForcedRests.clear();
      notifiedUnrecordedRests.clear();
    };
  }, [sessionId, reconnectNonce]);
}

/** 未対応項目（会費/名簿）の表示ラベル。受信した最新スナップショットから導出する。 */
function unresolvedLabelsOf(p: Player): string[] {
  const labels = unresolvedOpsOf(p).map((f) =>
    f === 'payment' ? '会費の支払い' : '名簿の記入',
  );
  return labels.length > 0 ? labels : ['会費・名簿の対応'];
}

/**
 * 未対応強制休憩（`forcedRestAt` が新しくセットされたプレイヤー）を全メンバーに
 * 通知する。強制休憩を実施した端末も自分の onSnapshot でここを通るので全端末に
 * 届く。通知許可が無いメンバーにも見えるよう、Browser Notification に加えて
 * グローバルトースト（noticeStore → App 直下の GlobalNotices）でも表示する。
 * 本人には「お願い」文言、他メンバーには「お知らせ」文言を出し分け、同時に
 * 複数人が対象になった場合は 1 件にまとめて出す（結果未登録通知と同様）。
 */
function checkForcedRestNotifications(newPlayers: Player[]) {
  const currentUser = useSessionStore.getState().currentUser;
  const targets: Player[] = [];
  for (const p of newPlayers) {
    if (!p.forcedRestAt) continue;
    const key = `${p.id}-${p.forcedRestAt}`;
    if (notifiedForcedRests.has(key)) continue;
    notifiedForcedRests.add(key);
    // 実施から 2 分以上経過していれば通知しない（リロード時の誤通知防止）
    if (Date.now() - p.forcedRestAt > 120_000) continue;
    targets.push(p);
  }
  if (targets.length === 0) return;

  const self = targets.find((p) => p.name === currentUser);
  const others = targets.filter((p) => p !== self);

  if (self) {
    const message = `${unresolvedLabelsOf(self).join('と')}がまだのため、休憩になりました。対応後に休憩を解除してください`;
    useNoticeStore.getState().show(message, 'warning', 8000);
    notifyForcedRest(self.name, message);
  }
  if (others.length > 0) {
    // 未対応項目はメンバーごとに違い得るので、まとめ文言では和集合を出す
    const labelSet = new Set(others.flatMap((p) => unresolvedLabelsOf(p)));
    const names = others.map((p) => `${p.name}さん`).join('・');
    const message = `${names}は${[...labelSet].join('と')}が未対応のため休憩になりました`;
    useNoticeStore.getState().show(message, 'warning', 8000);
    notifyForcedRest(others.map((p) => p.name).join('-'), message);
  }
}

/**
 * 結果未登録試合による強制休憩（`match.forcedRestAt` が新しくセットされた試合）を
 * 全メンバーに通知する。出場者本人には結果登録をお願いする文言、他メンバーには
 * お知らせ文言を出し分ける。checkForcedRestNotifications と同じく、グローバル
 * トースト + Browser Notification の両方で出す。
 */
function checkUnrecordedRestNotifications(matchHistory: Match[], players: Player[]) {
  const currentUser = useSessionStore.getState().currentUser;
  for (const m of matchHistory) {
    if (!m.forcedRestAt) continue;
    const key = `${m.id}-${m.forcedRestAt}`;
    if (notifiedUnrecordedRests.has(key)) continue;
    notifiedUnrecordedRests.add(key);
    // 実施から 2 分以上経過していれば通知しない（リロード時の誤通知防止）
    if (Date.now() - m.forcedRestAt > 120_000) continue;

    const participantIds = [...m.teamA, ...m.teamB].filter((pid) => pid);
    const names = participantIds.map(
      (pid) => players.find((p) => p.id === pid)?.name ?? '未設定',
    );
    const isParticipant =
      currentUser !== null && names.includes(currentUser);
    const message = isParticipant
      ? '出場した試合の結果が未登録のため、休憩になりました。結果の登録をお願いします'
      : `${names.map((n) => `${n}さん`).join('・')}は試合結果が未登録のため休憩になりました`;

    useNoticeStore.getState().show(message, 'warning', 8000);
    notifyForcedRest(m.id, message);
  }
}
