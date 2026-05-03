import { useCallback, useMemo } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useReservationStore } from '../stores/reservationStore';
import { useSettingsStore } from '../stores/settingsStore';
import * as sm from '../services/sessionMutations';
import { SessionError } from '../lib/errorHandler';
import type { Player } from '../types/player';
import type { Court } from '../types/court';
import type { Match } from '../types/match';

/**
 * セッションのゲーム状態への書き込みを 1 つの API に集約するフック。
 *
 * 共有セッション（`session.createdBy` あり）では Firestore transaction
 * (`sessionMutations.X`) を呼ぶ。非共有セッション（オフライン / 旧モード）では
 * 既存の zustand store action を呼ぶ。
 *
 * Phase 4 でローカルモードを廃止する際は、各メソッドの非共有ブランチを
 * 削除するだけで済む（呼び出し側は変更不要）。
 *
 * 設計メモ:
 *   - 共有モードでは onSnapshot がストアを更新するので、wrapper 内で
 *     楽観的に setState はしない（巻き戻りリスクを排除）。
 *   - 戻り値が必要な操作（addPlayers の added/skipped 等）のみ async。
 *   - zustand action は安定参照なので、各 store から個別 selector で取り出して
 *     再レンダーを抑える（オブジェクトリテラルの selector は毎回新参照になる）。
 *   - `onError` callback を渡すと共有モード transaction の失敗を呼び出し側に通知できる。
 *     未指定時は `console.error` のみ（呼び出し側が `void writer.X(...)` でも
 *     未捕捉 Promise rejection にならないように内部で握る）。
 */
export interface SessionWriterOptions {
  /** 共有モードで sessionMutations の transaction が失敗した場合に呼ばれる */
  onError?: (err: unknown, op: string) => void;
}

export function useSessionWriter(options?: SessionWriterOptions) {
  const session = useSessionStore((s) => s.session);
  const sessionId = session?.id;
  const isShared = !!session?.createdBy && !!sessionId;

  const onError = options?.onError;
  const handle = useCallback(
    async <T>(op: string, fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn();
      } catch (err) {
        const code = err instanceof SessionError ? err.code : undefined;
        console.error(`[useSessionWriter] ${op} failed${code ? ` (${code})` : ''}:`, err);
        onError?.(err, op);
        return undefined;
      }
    },
    [onError],
  );

  // ---- player actions（個別 selector で安定参照を維持） ----
  const addPlayersLocal = usePlayerStore((s) => s.addPlayers);
  const removePlayerLocal = usePlayerStore((s) => s.removePlayer);
  const updatePlayerLocal = usePlayerStore((s) => s.updatePlayer);
  const toggleRestLocal = usePlayerStore((s) => s.toggleRest);
  const toggleOperationStatusLocal = usePlayerStore((s) => s.toggleOperationStatus);
  const applyPaymentLocal = usePlayerStore((s) => s.applyPayment);
  const incrementGamesPlayedLocal = usePlayerStore((s) => s.incrementGamesPlayed);
  const setAllPlayersRestingLocal = usePlayerStore((s) => s.setAllPlayersResting);
  const clearPlayersLocal = usePlayerStore((s) => s.clearPlayers);

  // ---- game actions ----
  const initializeCourtsLocal = useGameStore((s) => s.initializeCourts);
  const resizeCourtsLocal = useGameStore((s) => s.resizeCourts);
  const removeCourtByIdLocal = useGameStore((s) => s.removeCourtById);
  const updateCourtLocal = useGameStore((s) => s.updateCourt);
  const startGameLocal = useGameStore((s) => s.startGame);
  const resetAllCourtsLocal = useGameStore((s) => s.resetAllCourts);
  const clearHistoryLocal = useGameStore((s) => s.clearHistory);
  const removeMatchLocal = useGameStore((s) => s.removeMatch);

  // ---- reservation actions ----
  const addReservationLocal = useReservationStore((s) => s.addReservation);
  const removeReservationLocal = useReservationStore((s) => s.removeReservation);
  const fulfillReservationLocal = useReservationStore((s) => s.fulfillReservation);
  const clearReservationsLocal = useReservationStore((s) => s.clearReservations);

  // ---- settings actions ----
  const setRecordScoresLocal = useSettingsStore((s) => s.setRecordScores);
  const setContinuousMatchModeLocal = useSettingsStore((s) => s.setContinuousMatchMode);
  const setPracticeTypeLocal = useSettingsStore((s) => s.setPracticeType);

  // ===== Players =====
  const addPlayers = useCallback(
    async (
      inputs: { name: string; rating?: number; gender?: 'M' | 'F' }[],
    ): Promise<{ added: number; skipped: string[] }> => {
      if (isShared && sessionId) {
        const r = await handle('addPlayers', () => sm.addPlayers(sessionId, inputs));
        return r ? { added: r.added, skipped: r.skipped } : { added: 0, skipped: [] };
      }
      return addPlayersLocal(inputs);
    },
    [isShared, sessionId, handle, addPlayersLocal],
  );

  const removePlayer = useCallback(
    async (id: string) => {
      if (isShared && sessionId) {
        await handle('removePlayer', () => sm.removePlayer(sessionId, id));
        return;
      }
      removePlayerLocal(id);
    },
    [isShared, sessionId, handle, removePlayerLocal],
  );

  const updatePlayer = useCallback(
    async (id: string, updates: Omit<Partial<Player>, 'id'>) => {
      if (isShared && sessionId) {
        await handle('updatePlayer', () => sm.updatePlayer(sessionId, id, updates));
        return;
      }
      updatePlayerLocal(id, updates);
    },
    [isShared, sessionId, handle, updatePlayerLocal],
  );

  const toggleRest = useCallback(
    async (id: string) => {
      if (isShared && sessionId) {
        await handle('toggleRest', () => sm.toggleRest(sessionId, id));
        return;
      }
      toggleRestLocal(id);
    },
    [isShared, sessionId, handle, toggleRestLocal],
  );

  const toggleOperationStatus = useCallback(
    async (id: string, field: 'payment' | 'roster' | 'checkin') => {
      if (isShared && sessionId) {
        await handle('toggleOperationStatus', () =>
          sm.toggleOperationStatus(sessionId, id, field),
        );
        return;
      }
      toggleOperationStatusLocal(id, field);
    },
    [isShared, sessionId, handle, toggleOperationStatusLocal],
  );

  const applyPayment = useCallback(
    async (id: string, amount: number) => {
      if (isShared && sessionId) {
        await handle('applyPayment', () => sm.applyPayment(sessionId, id, amount));
        return;
      }
      applyPaymentLocal(id, amount);
    },
    [isShared, sessionId, handle, applyPaymentLocal],
  );

  const incrementGamesPlayed = useCallback(
    async (ids: string[], lastPlayedAt: number = Date.now()) => {
      if (isShared && sessionId) {
        await handle('incrementGamesPlayed', () =>
          sm.incrementGamesPlayed(sessionId, ids, lastPlayedAt),
        );
        return;
      }
      incrementGamesPlayedLocal(ids, lastPlayedAt);
    },
    [isShared, sessionId, handle, incrementGamesPlayedLocal],
  );

  const setAllPlayersResting = useCallback(async () => {
    if (isShared && sessionId) {
      await handle('setAllPlayersResting', () => sm.setAllPlayersResting(sessionId));
      return;
    }
    setAllPlayersRestingLocal();
  }, [isShared, sessionId, handle, setAllPlayersRestingLocal]);

  const clearPlayers = useCallback(async () => {
    if (isShared && sessionId) {
      await handle('clearPlayers', () => sm.clearPlayers(sessionId));
      return;
    }
    clearPlayersLocal();
  }, [isShared, sessionId, handle, clearPlayersLocal]);

  // ===== Courts =====
  const initializeCourts = useCallback(
    async (count: number) => {
      if (isShared && sessionId) {
        await handle('initializeCourts', () => sm.initializeCourts(sessionId, count));
        return;
      }
      initializeCourtsLocal(count);
    },
    [isShared, sessionId, handle, initializeCourtsLocal],
  );

  const resizeCourts = useCallback(
    async (count: number) => {
      if (isShared && sessionId) {
        await handle('resizeCourts', () => sm.resizeCourts(sessionId, count));
        return;
      }
      resizeCourtsLocal(count);
    },
    [isShared, sessionId, handle, resizeCourtsLocal],
  );

  const removeCourtById = useCallback(
    async (courtId: number) => {
      if (isShared && sessionId) {
        await handle('removeCourt', () => sm.removeCourt(sessionId, courtId));
        return;
      }
      removeCourtByIdLocal(courtId);
    },
    [isShared, sessionId, handle, removeCourtByIdLocal],
  );

  const updateCourt = useCallback(
    async (courtId: number, updates: Partial<Court>) => {
      if (isShared && sessionId) {
        await handle('updateCourt', () => sm.updateCourt(sessionId, courtId, updates));
        return;
      }
      updateCourtLocal(courtId, updates);
    },
    [isShared, sessionId, handle, updateCourtLocal],
  );

  const startGame = useCallback(
    async (courtId: number) => {
      if (isShared && sessionId) {
        await handle('startGame', () => sm.startGame(sessionId, courtId));
        return;
      }
      startGameLocal(courtId);
    },
    [isShared, sessionId, handle, startGameLocal],
  );

  const resetAllCourts = useCallback(async () => {
    if (isShared && sessionId) {
      await handle('resetAllCourts', () => sm.resetAllCourts(sessionId));
      return;
    }
    resetAllCourtsLocal();
  }, [isShared, sessionId, handle, resetAllCourtsLocal]);

  // ===== Match history =====
  const clearHistory = useCallback(async () => {
    if (isShared && sessionId) {
      await handle('clearHistory', () => sm.clearHistory(sessionId));
      return;
    }
    clearHistoryLocal();
  }, [isShared, sessionId, handle, clearHistoryLocal]);

  const removeMatch = useCallback(
    async (matchId: string) => {
      if (isShared && sessionId) {
        await handle('removeMatch', () => sm.removeMatch(sessionId, matchId));
        return;
      }
      removeMatchLocal(matchId);
    },
    [isShared, sessionId, handle, removeMatchLocal],
  );

  const updateMatchScore = useCallback(
    async (
      matchId: string,
      scoreA: number,
      scoreB: number,
      winner?: 'A' | 'B',
    ) => {
      if (isShared && sessionId) {
        await handle('updateMatchScore', () =>
          sm.updateMatchScore(sessionId, matchId, scoreA, scoreB, winner),
        );
        return;
      }
      // 非共有時はローカル store の matchHistory を直接更新（gameStore に対応 action なし）
      useGameStore.setState((state) => ({
        matchHistory: state.matchHistory.map((m: Match) =>
          m.id === matchId
            ? winner === undefined
              ? { ...m, scoreA, scoreB }
              : { ...m, scoreA, scoreB, winner }
            : m,
        ),
      }));
    },
    [isShared, sessionId, handle],
  );

  // ===== Reservations =====
  const addReservation = useCallback(
    async (playerIds: string[], createdBy?: string) => {
      if (isShared && sessionId) {
        await handle('addReservation', () =>
          sm.addReservation(sessionId, playerIds, createdBy),
        );
        return;
      }
      addReservationLocal(playerIds, createdBy);
    },
    [isShared, sessionId, handle, addReservationLocal],
  );

  const removeReservation = useCallback(
    async (reservationId: string) => {
      if (isShared && sessionId) {
        await handle('removeReservation', () =>
          sm.removeReservation(sessionId, reservationId),
        );
        return;
      }
      removeReservationLocal(reservationId);
    },
    [isShared, sessionId, handle, removeReservationLocal],
  );

  const fulfillReservation = useCallback(
    async (reservationId: string) => {
      if (isShared && sessionId) {
        await handle('fulfillReservation', () =>
          sm.fulfillReservation(sessionId, reservationId),
        );
        return;
      }
      fulfillReservationLocal(reservationId);
    },
    [isShared, sessionId, handle, fulfillReservationLocal],
  );

  const clearReservations = useCallback(async () => {
    if (isShared && sessionId) {
      await handle('clearReservations', () => sm.clearReservations(sessionId));
      return;
    }
    clearReservationsLocal();
  }, [isShared, sessionId, handle, clearReservationsLocal]);

  // ===== Settings =====
  const setRecordScores = useCallback(
    async (value: boolean) => {
      if (isShared && sessionId) {
        await handle('setRecordScores', () => sm.setRecordScores(sessionId, value));
        return;
      }
      setRecordScoresLocal(value);
    },
    [isShared, sessionId, handle, setRecordScoresLocal],
  );

  const setContinuousMatchMode = useCallback(
    async (value: boolean) => {
      if (isShared && sessionId) {
        await handle('setContinuousMatchMode', () =>
          sm.setContinuousMatchMode(sessionId, value),
        );
        return;
      }
      setContinuousMatchModeLocal(value);
    },
    [isShared, sessionId, handle, setContinuousMatchModeLocal],
  );

  const setPracticeType = useCallback(
    async (value: '単' | '複' | '楽') => {
      // 端末ローカルの prioritizeDiversity も整合させる（'単'→false, '楽'→true）
      if (value === '単') useSettingsStore.setState({ prioritizeDiversity: false });
      else if (value === '楽') useSettingsStore.setState({ prioritizeDiversity: true });

      if (isShared && sessionId) {
        await handle('setPracticeType', () => sm.setPracticeType(sessionId, value));
        return;
      }
      setPracticeTypeLocal(value);
    },
    [isShared, sessionId, handle, setPracticeTypeLocal],
  );

  return useMemo(
    () => ({
      isShared,
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
      removeCourtById,
      updateCourt,
      startGame,
      resetAllCourts,
      // match history
      clearHistory,
      removeMatch,
      updateMatchScore,
      // reservations
      addReservation,
      removeReservation,
      fulfillReservation,
      clearReservations,
      // settings
      setRecordScores,
      setContinuousMatchMode,
      setPracticeType,
    }),
    [
      isShared,
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
      removeCourtById,
      updateCourt,
      startGame,
      resetAllCourts,
      clearHistory,
      removeMatch,
      updateMatchScore,
      addReservation,
      removeReservation,
      fulfillReservation,
      clearReservations,
      setRecordScores,
      setContinuousMatchMode,
      setPracticeType,
    ],
  );
}
