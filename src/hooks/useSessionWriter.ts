import { useCallback, useMemo } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useReservationStore } from '../stores/reservationStore';
import { useSettingsStore } from '../stores/settingsStore';
import * as sm from '../services/sessionMutations';
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
 */
export function useSessionWriter() {
  const session = useSessionStore((s) => s.session);
  const sessionId = session?.id;
  const isShared = !!session?.createdBy && !!sessionId;

  // 非共有時のフォールバック先（zustand actions）
  const playerActions = usePlayerStore((s) => ({
    addPlayers: s.addPlayers,
    removePlayer: s.removePlayer,
    updatePlayer: s.updatePlayer,
    toggleRest: s.toggleRest,
    toggleOperationStatus: s.toggleOperationStatus,
    applyPayment: s.applyPayment,
    incrementGamesPlayed: s.incrementGamesPlayed,
    setAllPlayersResting: s.setAllPlayersResting,
    clearPlayers: s.clearPlayers,
  }));
  const gameActions = useGameStore((s) => ({
    initializeCourts: s.initializeCourts,
    resizeCourts: s.resizeCourts,
    removeCourtById: s.removeCourtById,
    updateCourt: s.updateCourt,
    startGame: s.startGame,
    resetAllCourts: s.resetAllCourts,
    clearHistory: s.clearHistory,
    removeMatch: s.removeMatch,
  }));
  const reservationActions = useReservationStore((s) => ({
    addReservation: s.addReservation,
    removeReservation: s.removeReservation,
    fulfillReservation: s.fulfillReservation,
    clearReservations: s.clearReservations,
  }));
  const settingsActions = useSettingsStore((s) => ({
    setRecordScores: s.setRecordScores,
    setContinuousMatchMode: s.setContinuousMatchMode,
    setPracticeType: s.setPracticeType,
  }));

  // ===== Players =====
  const addPlayers = useCallback(
    async (
      inputs: { name: string; rating?: number; gender?: 'M' | 'F' }[],
    ): Promise<{ added: number; skipped: string[] }> => {
      if (isShared && sessionId) {
        const r = await sm.addPlayers(sessionId, inputs);
        return { added: r.added, skipped: r.skipped };
      }
      return playerActions.addPlayers(inputs);
    },
    [isShared, sessionId, playerActions],
  );

  const removePlayer = useCallback(
    async (id: string) => {
      if (isShared && sessionId) {
        await sm.removePlayer(sessionId, id);
        return;
      }
      playerActions.removePlayer(id);
    },
    [isShared, sessionId, playerActions],
  );

  const updatePlayer = useCallback(
    async (id: string, updates: Omit<Partial<Player>, 'id'>) => {
      if (isShared && sessionId) {
        await sm.updatePlayer(sessionId, id, updates);
        return;
      }
      playerActions.updatePlayer(id, updates);
    },
    [isShared, sessionId, playerActions],
  );

  const toggleRest = useCallback(
    async (id: string) => {
      if (isShared && sessionId) {
        await sm.toggleRest(sessionId, id);
        return;
      }
      playerActions.toggleRest(id);
    },
    [isShared, sessionId, playerActions],
  );

  const toggleOperationStatus = useCallback(
    async (id: string, field: 'payment' | 'roster' | 'checkin') => {
      if (isShared && sessionId) {
        await sm.toggleOperationStatus(sessionId, id, field);
        return;
      }
      playerActions.toggleOperationStatus(id, field);
    },
    [isShared, sessionId, playerActions],
  );

  const applyPayment = useCallback(
    async (id: string, amount: number) => {
      if (isShared && sessionId) {
        await sm.applyPayment(sessionId, id, amount);
        return;
      }
      playerActions.applyPayment(id, amount);
    },
    [isShared, sessionId, playerActions],
  );

  const incrementGamesPlayed = useCallback(
    async (ids: string[], lastPlayedAt: number = Date.now()) => {
      if (isShared && sessionId) {
        await sm.incrementGamesPlayed(sessionId, ids, lastPlayedAt);
        return;
      }
      playerActions.incrementGamesPlayed(ids, lastPlayedAt);
    },
    [isShared, sessionId, playerActions],
  );

  const setAllPlayersResting = useCallback(async () => {
    if (isShared && sessionId) {
      await sm.setAllPlayersResting(sessionId);
      return;
    }
    playerActions.setAllPlayersResting();
  }, [isShared, sessionId, playerActions]);

  const clearPlayers = useCallback(async () => {
    if (isShared && sessionId) {
      await sm.clearPlayers(sessionId);
      return;
    }
    playerActions.clearPlayers();
  }, [isShared, sessionId, playerActions]);

  // ===== Courts =====
  const initializeCourts = useCallback(
    async (count: number) => {
      if (isShared && sessionId) {
        await sm.initializeCourts(sessionId, count);
        return;
      }
      gameActions.initializeCourts(count);
    },
    [isShared, sessionId, gameActions],
  );

  const resizeCourts = useCallback(
    async (count: number) => {
      if (isShared && sessionId) {
        await sm.resizeCourts(sessionId, count);
        return;
      }
      gameActions.resizeCourts(count);
    },
    [isShared, sessionId, gameActions],
  );

  const removeCourtById = useCallback(
    async (courtId: number) => {
      if (isShared && sessionId) {
        await sm.removeCourt(sessionId, courtId);
        return;
      }
      gameActions.removeCourtById(courtId);
    },
    [isShared, sessionId, gameActions],
  );

  const updateCourt = useCallback(
    async (courtId: number, updates: Partial<Court>) => {
      if (isShared && sessionId) {
        await sm.updateCourt(sessionId, courtId, updates);
        return;
      }
      gameActions.updateCourt(courtId, updates);
    },
    [isShared, sessionId, gameActions],
  );

  const startGame = useCallback(
    async (courtId: number) => {
      if (isShared && sessionId) {
        await sm.startGame(sessionId, courtId);
        return;
      }
      gameActions.startGame(courtId);
    },
    [isShared, sessionId, gameActions],
  );

  const resetAllCourts = useCallback(async () => {
    if (isShared && sessionId) {
      await sm.resetAllCourts(sessionId);
      return;
    }
    gameActions.resetAllCourts();
  }, [isShared, sessionId, gameActions]);

  // ===== Match history =====
  const clearHistory = useCallback(async () => {
    if (isShared && sessionId) {
      await sm.clearHistory(sessionId);
      return;
    }
    gameActions.clearHistory();
  }, [isShared, sessionId, gameActions]);

  const removeMatch = useCallback(
    async (matchId: string) => {
      if (isShared && sessionId) {
        await sm.removeMatch(sessionId, matchId);
        return;
      }
      gameActions.removeMatch(matchId);
    },
    [isShared, sessionId, gameActions],
  );

  const updateMatchScore = useCallback(
    async (
      matchId: string,
      scoreA: number,
      scoreB: number,
      winner?: 'A' | 'B',
    ) => {
      if (isShared && sessionId) {
        await sm.updateMatchScore(sessionId, matchId, scoreA, scoreB, winner);
        return;
      }
      // 非共有ではローカル store の matchHistory を更新
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
    [isShared, sessionId],
  );

  // ===== Reservations =====
  const addReservation = useCallback(
    async (playerIds: string[], createdBy?: string) => {
      if (isShared && sessionId) {
        await sm.addReservation(sessionId, playerIds, createdBy);
        return;
      }
      reservationActions.addReservation(playerIds, createdBy);
    },
    [isShared, sessionId, reservationActions],
  );

  const removeReservation = useCallback(
    async (reservationId: string) => {
      if (isShared && sessionId) {
        await sm.removeReservation(sessionId, reservationId);
        return;
      }
      reservationActions.removeReservation(reservationId);
    },
    [isShared, sessionId, reservationActions],
  );

  const fulfillReservation = useCallback(
    async (reservationId: string) => {
      if (isShared && sessionId) {
        await sm.fulfillReservation(sessionId, reservationId);
        return;
      }
      reservationActions.fulfillReservation(reservationId);
    },
    [isShared, sessionId, reservationActions],
  );

  const clearReservations = useCallback(async () => {
    if (isShared && sessionId) {
      await sm.clearReservations(sessionId);
      return;
    }
    reservationActions.clearReservations();
  }, [isShared, sessionId, reservationActions]);

  // ===== Settings =====
  const setRecordScores = useCallback(
    async (value: boolean) => {
      if (isShared && sessionId) {
        await sm.setRecordScores(sessionId, value);
        return;
      }
      settingsActions.setRecordScores(value);
    },
    [isShared, sessionId, settingsActions],
  );

  const setContinuousMatchMode = useCallback(
    async (value: boolean) => {
      if (isShared && sessionId) {
        await sm.setContinuousMatchMode(sessionId, value);
        return;
      }
      settingsActions.setContinuousMatchMode(value);
    },
    [isShared, sessionId, settingsActions],
  );

  const setPracticeType = useCallback(
    async (value: '単' | '複' | '楽') => {
      // 端末ローカルの prioritizeDiversity も整合させる（'単'→false, '楽'→true）
      if (value === '単') useSettingsStore.setState({ prioritizeDiversity: false });
      else if (value === '楽') useSettingsStore.setState({ prioritizeDiversity: true });

      if (isShared && sessionId) {
        await sm.setPracticeType(sessionId, value);
        return;
      }
      settingsActions.setPracticeType(value);
    },
    [isShared, sessionId, settingsActions],
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
