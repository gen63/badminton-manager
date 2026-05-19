import { useCallback, useMemo } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import * as sm from '../services/sessionMutations';
import { SessionError } from '../lib/errorHandler';
import type { Player } from '../types/player';
import type { Court } from '../types/court';
import type { Match } from '../types/match';

/**
 * セッションのゲーム状態への書き込みを 1 つの API に集約するフック。
 *
 * Phase 4 で Firebase 必須化したため、常に `sessionMutations.X`
 * (Firestore transaction) を呼ぶ。`sessionId` が未設定の操作は no-op。
 *
 * 設計メモ:
 *   - onSnapshot がストアを更新するので、wrapper 内で楽観的に setState はしない。
 *   - 戻り値が必要な操作（addPlayers の added/skipped 等）のみ async。
 *   - `onError` callback を渡すと transaction の失敗を呼び出し側に通知できる。
 *     未指定時は `console.error` のみ（呼び出し側が `void writer.X(...)` でも
 *     未捕捉 Promise rejection にならないように内部で握る）。
 */
export interface SessionWriterOptions {
  /** sessionMutations の transaction が失敗した場合に呼ばれる */
  onError?: (err: unknown, op: string) => void;
}

export function useSessionWriter(options?: SessionWriterOptions) {
  const sessionId = useSessionStore((s) => s.session?.id);

  const onError = options?.onError;
  const handle = useCallback(
    async <T>(op: string, fn: (sid: string) => Promise<T>): Promise<T | undefined> => {
      if (!sessionId) return undefined;
      try {
        return await fn(sessionId);
      } catch (err) {
        const code = err instanceof SessionError ? err.code : undefined;
        console.error(`[useSessionWriter] ${op} failed${code ? ` (${code})` : ''}:`, err);
        onError?.(err, op);
        return undefined;
      }
    },
    [sessionId, onError],
  );

  // ===== Players =====
  const addPlayers = useCallback(
    async (
      inputs: { name: string; rating?: number; gender?: 'M' | 'F' }[],
    ): Promise<{ added: number; skipped: string[] }> => {
      const r = await handle('addPlayers', (sid) => sm.addPlayers(sid, inputs));
      return r ? { added: r.added, skipped: r.skipped } : { added: 0, skipped: [] };
    },
    [handle],
  );

  const removePlayer = useCallback(
    (id: string) => handle('removePlayer', (sid) => sm.removePlayer(sid, id)),
    [handle],
  );

  const updatePlayer = useCallback(
    (id: string, updates: Omit<Partial<Player>, 'id'>) =>
      handle('updatePlayer', (sid) => sm.updatePlayer(sid, id, updates)),
    [handle],
  );

  const toggleRest = useCallback(
    (id: string) => handle('toggleRest', (sid) => sm.toggleRest(sid, id)),
    [handle],
  );

  const toggleOperationStatus = useCallback(
    (id: string, field: 'payment' | 'roster' | 'checkin') =>
      handle('toggleOperationStatus', (sid) => sm.toggleOperationStatus(sid, id, field)),
    [handle],
  );

  const applyPayment = useCallback(
    (id: string, amount: number) =>
      handle('applyPayment', (sid) => sm.applyPayment(sid, id, amount)),
    [handle],
  );

  const incrementGamesPlayed = useCallback(
    (ids: string[], lastPlayedAt: number = Date.now()) =>
      handle('incrementGamesPlayed', (sid) => sm.incrementGamesPlayed(sid, ids, lastPlayedAt)),
    [handle],
  );

  const setAllPlayersResting = useCallback(
    () => handle('setAllPlayersResting', (sid) => sm.setAllPlayersResting(sid)),
    [handle],
  );

  const clearPlayers = useCallback(
    () => handle('clearPlayers', (sid) => sm.clearPlayers(sid)),
    [handle],
  );

  // ===== Courts =====
  const initializeCourts = useCallback(
    (count: number) => handle('initializeCourts', (sid) => sm.initializeCourts(sid, count)),
    [handle],
  );

  const resizeCourts = useCallback(
    (count: number) => handle('resizeCourts', (sid) => sm.resizeCourts(sid, count)),
    [handle],
  );

  const resizeCourtsWithConfig = useCallback(
    (count: number) =>
      handle('resizeCourtsWithConfig', (sid) => sm.resizeCourtsWithConfig(sid, count)),
    [handle],
  );

  const autoAssignAndFulfill = useCallback(
    (assignments: sm.AutoAssignSpec[], fulfilledReservationIds: string[]) =>
      handle('autoAssignAndFulfill', (sid) =>
        sm.autoAssignAndFulfill(sid, assignments, fulfilledReservationIds),
      ),
    [handle],
  );

  const swapPlayer = useCallback(
    (courtId: number, position: 0 | 1 | 2 | 3, newPlayerId: string) =>
      handle('swapPlayer', (sid) => sm.swapPlayer(sid, courtId, position, newPlayerId)),
    [handle],
  );

  const swapPositions = useCallback(
    (
      posA: { courtId: number; position: 0 | 1 | 2 | 3 },
      posB: { courtId: number; position: 0 | 1 | 2 | 3 },
    ) => handle('swapPositions', (sid) => sm.swapPositions(sid, posA, posB)),
    [handle],
  );

  const removeCourtById = useCallback(
    (courtId: number) => handle('removeCourt', (sid) => sm.removeCourt(sid, courtId)),
    [handle],
  );

  const updateCourt = useCallback(
    (courtId: number, updates: Partial<Court>) =>
      handle('updateCourt', (sid) => sm.updateCourt(sid, courtId, updates)),
    [handle],
  );

  const startGame = useCallback(
    (courtId: number) => handle('startGame', (sid) => sm.startGame(sid, courtId)),
    [handle],
  );

  const resetAllCourts = useCallback(
    () => handle('resetAllCourts', (sid) => sm.resetAllCourts(sid)),
    [handle],
  );

  // ===== Match history =====
  const clearHistory = useCallback(
    () => handle('clearHistory', (sid) => sm.clearHistory(sid)),
    [handle],
  );

  const removeMatch = useCallback(
    (matchId: string) => handle('removeMatch', (sid) => sm.removeMatch(sid, matchId)),
    [handle],
  );

  const updateMatchScore = useCallback(
    (matchId: string, scoreA: number, scoreB: number, winner?: 'A' | 'B') =>
      handle('updateMatchScore', (sid) =>
        sm.updateMatchScore(sid, matchId, scoreA, scoreB, winner),
      ),
    [handle],
  );

  const updateMatch = useCallback(
    (matchId: string, updates: Omit<Partial<Match>, 'id'>) =>
      handle('updateMatch', (sid) => sm.updateMatch(sid, matchId, updates)),
    [handle],
  );

  // ===== Reservations =====
  const addReservation = useCallback(
    (playerIds: string[], createdBy?: string) =>
      handle('addReservation', (sid) => sm.addReservation(sid, playerIds, createdBy)),
    [handle],
  );

  const removeReservation = useCallback(
    (reservationId: string) =>
      handle('removeReservation', (sid) => sm.removeReservation(sid, reservationId)),
    [handle],
  );

  const fulfillReservation = useCallback(
    (reservationId: string) =>
      handle('fulfillReservation', (sid) => sm.fulfillReservation(sid, reservationId)),
    [handle],
  );

  const clearReservations = useCallback(
    () => handle('clearReservations', (sid) => sm.clearReservations(sid)),
    [handle],
  );

  // ===== Settings =====
  const setRecordScores = useCallback(
    (value: boolean) => handle('setRecordScores', (sid) => sm.setRecordScores(sid, value)),
    [handle],
  );

  const setContinuousMatchMode = useCallback(
    (value: boolean) =>
      handle('setContinuousMatchMode', (sid) => sm.setContinuousMatchMode(sid, value)),
    [handle],
  );

  const setPracticeType = useCallback(
    async (value: '単' | '複' | '楽') => {
      // 端末ローカルの prioritizeDiversity も整合させる（'単'→false, '楽'→true）
      if (value === '単') useSettingsStore.setState({ prioritizeDiversity: false });
      else if (value === '楽') useSettingsStore.setState({ prioritizeDiversity: true });
      await handle('setPracticeType', (sid) => sm.setPracticeType(sid, value));
    },
    [handle],
  );

  const setLateBalanceMode = useCallback(
    (value: boolean) => handle('setLateBalanceMode', (sid) => sm.setLateBalanceMode(sid, value)),
    [handle],
  );

  return useMemo(
    () => ({
      sessionId,
      // players
      addPlayers,
      removePlayer,
      updatePlayer,
      toggleRest,
      toggleOperationStatus,
      applyPayment,
      incrementGamesPlayed,
      setAllPlayersResting,
      clearPlayers,
      // courts
      initializeCourts,
      resizeCourts,
      resizeCourtsWithConfig,
      removeCourtById,
      updateCourt,
      startGame,
      resetAllCourts,
      autoAssignAndFulfill,
      swapPlayer,
      swapPositions,
      // match history
      clearHistory,
      removeMatch,
      updateMatchScore,
      updateMatch,
      // reservations
      addReservation,
      removeReservation,
      fulfillReservation,
      clearReservations,
      // settings
      setRecordScores,
      setContinuousMatchMode,
      setPracticeType,
      setLateBalanceMode,
    }),
    [
      sessionId,
      addPlayers,
      removePlayer,
      updatePlayer,
      toggleRest,
      toggleOperationStatus,
      applyPayment,
      incrementGamesPlayed,
      setAllPlayersResting,
      clearPlayers,
      initializeCourts,
      resizeCourts,
      resizeCourtsWithConfig,
      removeCourtById,
      updateCourt,
      startGame,
      resetAllCourts,
      autoAssignAndFulfill,
      swapPlayer,
      swapPositions,
      clearHistory,
      removeMatch,
      updateMatchScore,
      updateMatch,
      addReservation,
      removeReservation,
      fulfillReservation,
      clearReservations,
      setRecordScores,
      setContinuousMatchMode,
      setPracticeType,
      setLateBalanceMode,
    ],
  );
}
