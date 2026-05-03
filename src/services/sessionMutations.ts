/**
 * セッションのゲーム状態への変更を、すべて Firestore transaction で表現する API。
 *
 * 設計:
 *   - 純粋な compute 関数（`compute*`）が次の `GameState` を計算する。
 *     これは Firestore に依存せずユニットテスト可能。
 *   - トランザクショナルラッパー（動詞で命名）が `runTransaction(read → compute → write)`
 *     を実行し、書き込まれた最終 `GameState` を返す。
 *   - 競合（aborted）は `SessionError('conflict')` に変換。
 *
 * Phase 1 ではこの API を「追加するだけ」で、既存のページ実装は未変更のまま。
 * Phase 2 で各書き込み呼び出しを順次このモジュール経由に置き換える。
 *
 * 詳細は `docs/plans/2026-05-03-firestore-as-source-of-truth.md` を参照。
 */

import {
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { SessionError } from '../lib/errorHandler';
import { computeFirstMatchStartedAt } from '../lib/sessionArchive';
import { computeFinishAndContinue, gameModeFromPracticeType } from '../lib/gameOperations';
import { EMPTY_COURT_STATE, type Court } from '../types/court';
import type { Player } from '../types/player';
import type { Match } from '../types/match';
import type { Reservation } from '../types/reservation';
import type { GameState } from './sessionService';

/** Firestore の `undefined` 不可制約を回避するため deep clone でフィルタ */
function sanitize<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function requireDb() {
  if (!db) {
    throw new SessionError(
      'Firebase が初期化されていません。設定を確認してください。',
      'no-firestore',
    );
  }
  return db;
}

/**
 * `runTransaction(read → apply → write)` の汎用ラッパー。
 *
 * `apply(remoteState)` が `GameState` を返すと、それを `gameState` フィールドに
 * 書き込み、`updatedAt` / `registeredPlayers` / `firstMatchStartedAt` も同時更新する。
 * `aborted` は `SessionError('conflict')` に変換し、それ以外は素通しする。
 */
async function mutateGameState(
  sessionId: string,
  apply: (state: GameState) => GameState,
): Promise<GameState> {
  const _db = requireDb();
  const ref = doc(_db, 'sessions', sessionId);

  try {
    return await runTransaction(_db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) {
        throw new SessionError('セッションが見つかりません', 'not-found');
      }
      const remote = snap.data().gameState as GameState | undefined;
      if (!remote) {
        throw new SessionError('セッションの状態が初期化されていません', 'invalid-state');
      }

      const next = apply(remote);

      transaction.update(ref, {
        gameState: sanitize(next),
        updatedAt: serverTimestamp(),
        registeredPlayers: next.players.map((p) => p.name),
        firstMatchStartedAt: computeFirstMatchStartedAt(next.matchHistory),
      });

      return next;
    });
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === 'aborted') {
      throw new SessionError(
        '他のユーザーが更新しました。もう一度お試しください',
        'conflict',
      );
    }
    throw error;
  }
}

// =============================================================================
// Players: pure compute
// =============================================================================

export interface PlayerInput {
  name: string;
  rating?: number;
  gender?: 'M' | 'F';
}

const DEFAULT_OP_STATUS: NonNullable<Player['operationStatus']> = {
  payment: false,
  roster: false,
  checkin: false,
};

export function computeAddPlayers(
  state: GameState,
  inputs: PlayerInput[],
  newIds: string[] = [],
): { state: GameState; added: number; skipped: string[] } {
  const existing = new Set(state.players.map((p) => p.name.trim()));
  const seen = new Set<string>();
  const skipped: string[] = [];
  const additions: Player[] = [];

  inputs.forEach((input, idx) => {
    const name = input.name.trim();
    if (!name) return;
    if (existing.has(name) || seen.has(name)) {
      skipped.push(name);
      return;
    }
    seen.add(name);
    additions.push({
      id: newIds[idx] ?? crypto.randomUUID(),
      name,
      rating: input.rating,
      gender: input.gender,
      isResting: true,
      gamesPlayed: 0,
      lastPlayedAt: 0,
      activatedAt: 0,
    });
  });

  return {
    state: { ...state, players: [...state.players, ...additions] },
    added: additions.length,
    skipped,
  };
}

export function computeRemovePlayer(state: GameState, playerId: string): GameState {
  return { ...state, players: state.players.filter((p) => p.id !== playerId) };
}

export function computeUpdatePlayer(
  state: GameState,
  playerId: string,
  updates: Partial<Player>,
): GameState {
  return {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? { ...p, ...updates } : p)),
  };
}

export function computeToggleRest(
  state: GameState,
  playerId: string,
  now: number = Date.now(),
): GameState {
  return {
    ...state,
    players: state.players.map((p) => {
      if (p.id !== playerId) return p;
      const newIsResting = !p.isResting;
      const newActivatedAt = !newIsResting && p.activatedAt === 0 ? now : p.activatedAt;
      return { ...p, isResting: newIsResting, activatedAt: newActivatedAt };
    }),
  };
}

export function computeToggleOperationStatus(
  state: GameState,
  playerId: string,
  field: 'payment' | 'roster' | 'checkin',
  now: number = Date.now(),
): GameState {
  return {
    ...state,
    players: state.players.map((p) => {
      if (p.id !== playerId) return p;
      const current = p.operationStatus ?? DEFAULT_OP_STATUS;
      const newValue = !current[field];
      const updates: Partial<Player> = {
        operationStatus: { ...current, [field]: newValue },
      };
      if (field === 'payment' && newValue) {
        updates.paymentTimestamp = now;
      }
      return { ...p, ...updates };
    }),
  };
}

export function computeApplyPayment(
  state: GameState,
  playerId: string,
  amount: number,
  now: number = Date.now(),
): GameState {
  return {
    ...state,
    players: state.players.map((p) => {
      if (p.id !== playerId) return p;
      const current = p.operationStatus ?? DEFAULT_OP_STATUS;
      const newPayment = !current.payment;
      const updates: Partial<Player> = {
        paymentAmount: amount,
        operationStatus: { ...current, payment: newPayment },
      };
      if (newPayment) updates.paymentTimestamp = now;
      return { ...p, ...updates };
    }),
  };
}

export function computeIncrementGamesPlayed(
  state: GameState,
  ids: string[],
  lastPlayedAt: number,
): GameState {
  if (ids.length === 0) return state;
  const idSet = new Set(ids);
  return {
    ...state,
    players: state.players.map((p) =>
      idSet.has(p.id) ? { ...p, gamesPlayed: p.gamesPlayed + 1, lastPlayedAt } : p,
    ),
  };
}

export function computeSetAllPlayersResting(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, isResting: true })),
  };
}

// =============================================================================
// Courts: pure compute
// =============================================================================

export function computeInitializeCourts(state: GameState, count: number): GameState {
  return {
    ...state,
    courts: Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      ...EMPTY_COURT_STATE,
    })),
  };
}

export function computeResizeCourts(state: GameState, count: number): GameState {
  const existing = state.courts;
  if (count >= existing.length) {
    const newCourts: Court[] = Array.from({ length: count - existing.length }, (_, i) => ({
      id: existing.length + i + 1,
      ...EMPTY_COURT_STATE,
    }));
    return { ...state, courts: [...existing, ...newCourts] };
  }
  const isCourtActive = (c: Court) => c.isPlaying || (c.teamA[0] && c.teamA[0] !== '');
  const activeCourts = existing.filter(isCourtActive);
  const emptyCourts = existing.filter((c) => !isCourtActive(c));
  if (activeCourts.length >= count) {
    const kept = activeCourts.slice(0, count);
    return {
      ...state,
      courts: kept
        .sort((a, b) => a.id - b.id)
        .map((c, i) => ({ ...c, id: i + 1 })),
    };
  }
  const kept = [...activeCourts, ...emptyCourts.slice(0, count - activeCourts.length)];
  return {
    ...state,
    courts: kept.sort((a, b) => a.id - b.id).map((c, i) => ({ ...c, id: i + 1 })),
  };
}

export function computeRemoveCourt(state: GameState, courtId: number): GameState {
  return {
    ...state,
    courts: state.courts
      .filter((c) => c.id !== courtId)
      .map((c, i) => ({ ...c, id: i + 1 })),
  };
}

export function computeUpdateCourt(
  state: GameState,
  courtId: number,
  updates: Partial<Court>,
): GameState {
  return {
    ...state,
    courts: state.courts.map((c) => (c.id === courtId ? { ...c, ...updates } : c)),
  };
}

export function computeStartGame(
  state: GameState,
  courtId: number,
  now: number = Date.now(),
): GameState {
  return {
    ...state,
    courts: state.courts.map((c) =>
      c.id === courtId ? { ...c, isPlaying: true, startedAt: now } : c,
    ),
  };
}

export function computeClearCourt(state: GameState, courtId: number): GameState {
  return {
    ...state,
    courts: state.courts.map((c) =>
      c.id === courtId ? { ...c, ...EMPTY_COURT_STATE, restingPlayerIds: [] } : c,
    ),
  };
}

// =============================================================================
// Match history: pure compute
// =============================================================================

export function computeAddMatch(state: GameState, match: Match): GameState {
  return { ...state, matchHistory: [...state.matchHistory, match] };
}

export function computeRemoveMatch(state: GameState, matchId: string): GameState {
  return {
    ...state,
    matchHistory: state.matchHistory.filter((m) => m.id !== matchId),
  };
}

export function computeUpdateMatchScore(
  state: GameState,
  matchId: string,
  scoreA: number,
  scoreB: number,
  winner?: 'A' | 'B',
): GameState {
  return {
    ...state,
    matchHistory: state.matchHistory.map((m) =>
      m.id === matchId ? { ...m, scoreA, scoreB, winner } : m,
    ),
  };
}

// =============================================================================
// Reservations: pure compute
// =============================================================================

export function computeAddReservation(
  state: GameState,
  playerIds: string[],
  createdBy?: string,
  id: string = crypto.randomUUID(),
  now: number = Date.now(),
): GameState {
  const maxOrder = state.reservations.reduce(
    (max, r) => Math.max(max, r.orderNumber ?? 0),
    0,
  );
  const reservation: Reservation = {
    id,
    orderNumber: maxOrder + 1,
    playerIds,
    status: 'pending',
    createdAt: now,
    fulfilledAt: 0,
    createdBy,
  };
  return { ...state, reservations: [...state.reservations, reservation] };
}

export function computeRemoveReservation(state: GameState, reservationId: string): GameState {
  return {
    ...state,
    reservations: state.reservations.filter((r) => r.id !== reservationId),
  };
}

export function computeFulfillReservation(
  state: GameState,
  reservationId: string,
  now: number = Date.now(),
): GameState {
  return {
    ...state,
    reservations: state.reservations.map((r) =>
      r.id === reservationId ? { ...r, status: 'fulfilled', fulfilledAt: now } : r,
    ),
  };
}

export function computeClearReservations(state: GameState): GameState {
  return { ...state, reservations: [] };
}

// =============================================================================
// Settings: pure compute
// =============================================================================

export function computeSetSetting<K extends keyof NonNullable<GameState['settings']>>(
  state: GameState,
  key: K,
  value: NonNullable<GameState['settings']>[K],
): GameState {
  return {
    ...state,
    settings: { ...(state.settings ?? {}), [key]: value },
  };
}

// =============================================================================
// Transactional wrappers: 各 user-facing operation を runTransaction で
// =============================================================================

export function addPlayers(sessionId: string, inputs: PlayerInput[]) {
  // 衝突回避を考慮し、UUID は wrapper 側で生成（compute 関数を deterministic に保つ）
  const ids = inputs.map(() => crypto.randomUUID());
  return mutateGameState(sessionId, (s) => computeAddPlayers(s, inputs, ids).state);
}

export function removePlayer(sessionId: string, playerId: string) {
  return mutateGameState(sessionId, (s) => computeRemovePlayer(s, playerId));
}

export function updatePlayer(sessionId: string, playerId: string, updates: Partial<Player>) {
  return mutateGameState(sessionId, (s) => computeUpdatePlayer(s, playerId, updates));
}

export function toggleRest(sessionId: string, playerId: string) {
  return mutateGameState(sessionId, (s) => computeToggleRest(s, playerId));
}

export function toggleOperationStatus(
  sessionId: string,
  playerId: string,
  field: 'payment' | 'roster' | 'checkin',
) {
  return mutateGameState(sessionId, (s) => computeToggleOperationStatus(s, playerId, field));
}

export function applyPayment(sessionId: string, playerId: string, amount: number) {
  return mutateGameState(sessionId, (s) => computeApplyPayment(s, playerId, amount));
}

export function incrementGamesPlayed(
  sessionId: string,
  ids: string[],
  lastPlayedAt: number = Date.now(),
) {
  return mutateGameState(sessionId, (s) => computeIncrementGamesPlayed(s, ids, lastPlayedAt));
}

export function setAllPlayersResting(sessionId: string) {
  return mutateGameState(sessionId, computeSetAllPlayersResting);
}

export function initializeCourts(sessionId: string, count: number) {
  return mutateGameState(sessionId, (s) => computeInitializeCourts(s, count));
}

export function resizeCourts(sessionId: string, count: number) {
  return mutateGameState(sessionId, (s) => computeResizeCourts(s, count));
}

export function removeCourt(sessionId: string, courtId: number) {
  return mutateGameState(sessionId, (s) => computeRemoveCourt(s, courtId));
}

export function updateCourt(sessionId: string, courtId: number, updates: Partial<Court>) {
  return mutateGameState(sessionId, (s) => computeUpdateCourt(s, courtId, updates));
}

export function startGame(sessionId: string, courtId: number) {
  return mutateGameState(sessionId, (s) => computeStartGame(s, courtId));
}

export function clearCourt(sessionId: string, courtId: number) {
  return mutateGameState(sessionId, (s) => computeClearCourt(s, courtId));
}

export function addMatch(sessionId: string, match: Match) {
  return mutateGameState(sessionId, (s) => computeAddMatch(s, match));
}

export function removeMatch(sessionId: string, matchId: string) {
  return mutateGameState(sessionId, (s) => computeRemoveMatch(s, matchId));
}

export function updateMatchScore(
  sessionId: string,
  matchId: string,
  scoreA: number,
  scoreB: number,
  winner?: 'A' | 'B',
) {
  return mutateGameState(sessionId, (s) =>
    computeUpdateMatchScore(s, matchId, scoreA, scoreB, winner),
  );
}

export function addReservation(sessionId: string, playerIds: string[], createdBy?: string) {
  const id = crypto.randomUUID();
  return mutateGameState(sessionId, (s) => computeAddReservation(s, playerIds, createdBy, id));
}

export function removeReservation(sessionId: string, reservationId: string) {
  return mutateGameState(sessionId, (s) => computeRemoveReservation(s, reservationId));
}

export function fulfillReservation(sessionId: string, reservationId: string) {
  return mutateGameState(sessionId, (s) => computeFulfillReservation(s, reservationId));
}

export function clearReservations(sessionId: string) {
  return mutateGameState(sessionId, computeClearReservations);
}

export function setRecordScores(sessionId: string, value: boolean) {
  return mutateGameState(sessionId, (s) => computeSetSetting(s, 'recordScores', value));
}

export function setContinuousMatchMode(sessionId: string, value: boolean) {
  return mutateGameState(sessionId, (s) => computeSetSetting(s, 'continuousMatchMode', value));
}

export function setPracticeType(sessionId: string, value: '単' | '複' | '楽') {
  return mutateGameState(sessionId, (s) => computeSetSetting(s, 'practiceType', value));
}

// =============================================================================
// Composite operations: 試合終了（既存 finishGameTransaction を取り込み）
// =============================================================================

export interface FinishGameOptions {
  matchId: string;
  useStayDurationPriority: boolean;
  prioritizeDiversity: boolean;
}

/**
 * 試合終了 + 連続モード配置を 1 transaction で実行する。
 *
 * `startedAt` をべき等キーとして二重終了を防ぐ。リモート側で既に終了済み
 * （isPlaying=false または startedAt が変わっている）の場合は `already_finished`
 * を返し、書き込みは行わない。
 *
 * 既存の `sessionService.finishGameTransaction` の置き換え版。
 * 設定（continuousMatchMode / practiceType）はリモート状態を優先採用する。
 */
export async function finishGame(
  sessionId: string,
  courtId: number,
  matchStartedAt: number,
  options: FinishGameOptions,
): Promise<{ result: 'success' | 'already_finished'; writtenState?: GameState }> {
  const _db = requireDb();
  const ref = doc(_db, 'sessions', sessionId);

  try {
    return await runTransaction(_db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) {
        throw new SessionError('セッションが見つかりません', 'not-found');
      }
      const remote = snap.data().gameState as GameState | undefined;
      if (!remote) {
        throw new SessionError('セッションの状態が初期化されていません', 'invalid-state');
      }
      const remoteCourt = remote.courts.find((c) => c.id === courtId);
      if (!remoteCourt?.isPlaying || remoteCourt.startedAt !== matchStartedAt) {
        return { result: 'already_finished' as const };
      }

      const remoteSettings = remote.settings;
      const gameMode = gameModeFromPracticeType(remoteSettings?.practiceType);
      const next = computeFinishAndContinue(remote, courtId, {
        continuousMatchMode: remoteSettings?.continuousMatchMode ?? false,
        useStayDurationPriority: options.useStayDurationPriority,
        prioritizeDiversity: options.prioritizeDiversity,
        gameMode,
        matchId: options.matchId,
      }).newState;

      transaction.update(ref, {
        gameState: sanitize(next),
        updatedAt: serverTimestamp(),
        registeredPlayers: next.players.map((p) => p.name),
        firstMatchStartedAt: computeFirstMatchStartedAt(next.matchHistory),
      });

      return { result: 'success' as const, writtenState: next };
    });
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === 'aborted') {
      throw new SessionError(
        '他のユーザーが更新しました。もう一度お試しください',
        'conflict',
      );
    }
    throw error;
  }
}
