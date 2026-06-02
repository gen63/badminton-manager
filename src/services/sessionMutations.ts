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
 * 詳細は `docs/plans/2026-05-03-firestore-as-source-of-truth.md` を参照。
 */

import {
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { SessionError } from '../lib/errorHandler';
import { requireDb, sanitize } from '../lib/firestoreUtils';
import { computeFirstMatchStartedAt } from '../lib/sessionArchive';
import { computeFinishAndContinue, gameModeFromPracticeType } from '../lib/gameOperations';
import { sanitizePlayerName } from '../lib/inputValidation';
import { EMPTY_COURT_STATE, type Court } from '../types/court';
import type { Player } from '../types/player';
import type { Match } from '../types/match';
import type { Reservation } from '../types/reservation';
import type { GameState } from './sessionService';

/** transaction.update の payload 型（gameState を主に書き込む） */
function buildGameStatePayload(next: GameState): Record<string, unknown> {
  return {
    gameState: sanitize(next),
    updatedAt: serverTimestamp(),
    registeredPlayers: next.players.map((p) => p.name),
    firstMatchStartedAt: computeFirstMatchStartedAt(next.matchHistory),
  };
}

/**
 * `runTransaction(read → apply → write)` の汎用ラッパー。
 *
 * `apply(remoteState)` が次の `GameState` を返すと、それを `gameState` フィールドに
 * 書き込み、`updatedAt` / `registeredPlayers` / `firstMatchStartedAt` も同時更新する。
 *
 * エラー変換:
 *   - セッション未存在: `SessionError('not-found')`
 *   - gameState 未初期化: `SessionError('invalid-state')`
 *   - Firestore aborted: `SessionError('conflict')`（他のエラーは素通し）
 *
 * 注意: Firestore は内部でトランザクションを最大 5 回まで自動リトライするので、
 * `apply` は **idempotent** であるべき（同じ入力に対して同じ出力 + 副作用が安全に
 * 繰り返せる）。UUID や時刻は wrapper のクロージャで 1 度だけ生成して `apply` に
 * 渡せば、リトライしても同じ値が使われる。
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
      transaction.update(ref, buildGameStatePayload(next));
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

/**
 * 既存の remote `gameState` を無視して `state` で **上書き** する。
 *
 * 用途:
 *   - 新規セッション初期化（`createSession` 直後、まだ `gameState` フィールドが無い）
 *   - undo / redo（保存されたスナップショットを丸ごと復元する）
 *
 * `mutateGameState` と異なり `gameState` 未初期化でも throw しない。
 * セッション document 自体は存在している必要がある。
 */
export async function overwriteGameState(
  sessionId: string,
  state: GameState,
): Promise<GameState> {
  const _db = requireDb();
  const ref = doc(_db, 'sessions', sessionId);

  try {
    return await runTransaction(_db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) {
        throw new SessionError('セッションが見つかりません', 'not-found');
      }
      transaction.update(ref, buildGameStatePayload(state));
      return state;
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
    // SEC2: 制御文字 / zero-width 除去 + 32 文字打ち切り
    const name = sanitizePlayerName(input.name);
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
  // DATA1 fix: プレイヤーを消すときに court / reservation の参照も整合的に更新する。
  // - court.teamA / teamB の該当 slot を空文字に
  // - reservation.playerIds から除外し、空になった予約は削除
  // matchHistory はそのまま（履歴上の名前は表示時に「未設定」フォールバック）。
  const blankTeam = (team: [string, string]): [string, string] => [
    team[0] === playerId ? '' : team[0],
    team[1] === playerId ? '' : team[1],
  ];
  return {
    ...state,
    players: state.players.filter((p) => p.id !== playerId),
    courts: state.courts.map((c) => ({
      ...c,
      teamA: blankTeam(c.teamA),
      teamB: blankTeam(c.teamB),
    })),
    reservations: state.reservations
      .map((r) => ({ ...r, playerIds: r.playerIds.filter((id) => id !== playerId) }))
      .filter((r) => r.playerIds.length > 0),
  };
}

export function computeUpdatePlayer(
  state: GameState,
  playerId: string,
  updates: Omit<Partial<Player>, 'id'>,
): GameState {
  // SEC2: name が含まれる場合 sanitize（rename 経由で攻撃文字列が入るのを防ぐ）
  let safeUpdates = updates;
  if (typeof updates.name === 'string') {
    const cleaned = sanitizePlayerName(updates.name);
    if (cleaned === null) {
      // 不正な name は更新しない
      const { name: _name, ...rest } = updates;
      void _name;
      safeUpdates = rest;
    } else {
      safeUpdates = { ...updates, name: cleaned };
    }
  }
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === playerId ? { ...p, ...safeUpdates, id: p.id } : p,
    ),
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

export function computeClearPlayers(state: GameState): GameState {
  return { ...state, players: [] };
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
      c.id === courtId ? { ...c, ...EMPTY_COURT_STATE } : c,
    ),
  };
}

export function computeResetAllCourts(state: GameState): GameState {
  return {
    ...state,
    courts: state.courts.map((c) => ({ ...c, ...EMPTY_COURT_STATE })),
  };
}

// =============================================================================
// Match history: pure compute
// =============================================================================

export function computeAddMatch(state: GameState, match: Match): GameState {
  return { ...state, matchHistory: [...state.matchHistory, match] };
}

/**
 * 与えられた matchHistory からプレイヤーの試合統計を再計算する。
 * - gamesPlayed = 履歴での出場試合数
 * - lastPlayedAt = 最後に出場した試合の finishedAt（未出場は 0）
 *
 * 試合終了時 (gameOperations.computeFinishAndContinue) は出場者の gamesPlayed を
 * +1 し lastPlayedAt を finishedAt にするのと同時に同じ試合を履歴へ追加する。
 * よって両値は常に matchHistory から導出可能であり、履歴削除・全消去の後に
 * この関数で再計算すれば、gamesPlayed / lastPlayedAt を履歴と整合させられる。
 */
function recomputePlayerMatchStats(
  players: GameState['players'],
  matchHistory: Match[],
): GameState['players'] {
  const games = new Map<string, number>();
  const last = new Map<string, number>();
  for (const m of matchHistory) {
    for (const id of [...m.teamA, ...m.teamB]) {
      if (!id) continue;
      games.set(id, (games.get(id) ?? 0) + 1);
      if (m.finishedAt > (last.get(id) ?? 0)) last.set(id, m.finishedAt);
    }
  }
  return players.map((p) => {
    const gamesPlayed = games.get(p.id) ?? 0;
    const lastPlayedAt = last.get(p.id) ?? 0;
    if (gamesPlayed === p.gamesPlayed && lastPlayedAt === p.lastPlayedAt) return p;
    return { ...p, gamesPlayed, lastPlayedAt };
  });
}

export function computeRemoveMatch(state: GameState, matchId: string): GameState {
  const matchHistory = state.matchHistory.filter((m) => m.id !== matchId);
  return {
    ...state,
    players: recomputePlayerMatchStats(state.players, matchHistory),
    matchHistory,
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
    matchHistory: state.matchHistory.map((m) => {
      if (m.id !== matchId) return m;
      // winner 未指定なら既存値を保持（undefined で上書きして消さない）
      return winner === undefined
        ? { ...m, scoreA, scoreB }
        : { ...m, scoreA, scoreB, winner };
    }),
  };
}

export function computeClearHistory(state: GameState): GameState {
  return {
    ...state,
    players: recomputePlayerMatchStats(state.players, []),
    matchHistory: [],
  };
}

// =============================================================================
// Reservations: pure compute
// =============================================================================

export function computeAddReservation(
  state: GameState,
  playerIds: string[],
  id: string,
  now: number,
  createdBy?: string,
): GameState {
  // DATA4 fix: 重複 ID を除き、存在しない / 空文字 ID も除く。空になったら no-op。
  const validIds = new Set(state.players.map((p) => p.id));
  const dedup: string[] = [];
  const seen = new Set<string>();
  for (const pid of playerIds) {
    if (!pid || !validIds.has(pid) || seen.has(pid)) continue;
    seen.add(pid);
    dedup.push(pid);
  }
  if (dedup.length === 0) return state;

  const maxOrder = state.reservations.reduce(
    (max, r) => Math.max(max, r.orderNumber ?? 0),
    0,
  );
  const reservation: Reservation = {
    id,
    orderNumber: maxOrder + 1,
    playerIds: dedup,
    status: 'pending',
    createdAt: now,
    fulfilledAt: 0,
    createdBy,
  };

  // 予約に入れたメンバーは休憩にする（自動配置の対象外にし、予約成立時のみ呼び出す）。
  // 現在プレイ中のメンバーはそのまま（試合後に computeFinishAndContinue が休憩へ）。
  const playingIds = new Set(
    state.courts.flatMap((c) => [...c.teamA, ...c.teamB]).filter((pid) => pid),
  );
  const reservedSet = new Set(dedup);
  const players = state.players.map((p) =>
    reservedSet.has(p.id) && !playingIds.has(p.id) && !p.isResting
      ? { ...p, isResting: true }
      : p,
  );

  return { ...state, players, reservations: [...state.reservations, reservation] };
}

export function computeRemoveReservation(
  state: GameState,
  reservationId: string,
  now: number = Date.now(),
): GameState {
  const removed = state.reservations.find((r) => r.id === reservationId);
  const reservations = state.reservations.filter((r) => r.id !== reservationId);

  if (!removed) return { ...state, reservations };

  // 削除した予約のメンバーで、他の未成立予約に含まれず・プレイ中でなく・現在休憩中の者を
  // 待機に戻す（予約に入れたとき自動で休憩にした分を解除する）。
  const stillReserved = new Set(
    reservations.filter((r) => r.status === 'pending').flatMap((r) => r.playerIds),
  );
  const playingIds = new Set(
    state.courts.flatMap((c) => [...c.teamA, ...c.teamB]).filter((pid) => pid),
  );
  const removedSet = new Set(removed.playerIds);
  const players = state.players.map((p) => {
    if (!removedSet.has(p.id) || !p.isResting) return p;
    if (stillReserved.has(p.id) || playingIds.has(p.id)) return p;
    return { ...p, isResting: false, activatedAt: p.activatedAt === 0 ? now : p.activatedAt };
  });

  return { ...state, players, reservations };
}

export function computeFulfillReservation(
  state: GameState,
  reservationId: string,
  now: number = Date.now(),
): GameState {
  // RES1 fix: 既に fulfilled な予約に再度呼ばれても fulfilledAt を上書きしない
  return {
    ...state,
    reservations: state.reservations.map((r) =>
      r.id === reservationId && r.status === 'pending'
        ? { ...r, status: 'fulfilled', fulfilledAt: now }
        : r,
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

/**
 * プレイヤーを追加する。`compute` の `added` / `skipped` を呼び出し側に返すので、
 * トースト表示等で「N 人追加 / M 人スキップ」を伝えられる。
 *
 * UUID は wrapper のクロージャで先に生成し、transaction リトライ時も同じ ID
 * が使われるようにする（idempotent）。
 */
export async function addPlayers(
  sessionId: string,
  inputs: PlayerInput[],
): Promise<{ state: GameState; added: number; skipped: string[] }> {
  const ids = inputs.map(() => crypto.randomUUID());
  let lastResult: { added: number; skipped: string[] } = { added: 0, skipped: [] };
  const state = await mutateGameState(sessionId, (s) => {
    const computed = computeAddPlayers(s, inputs, ids);
    lastResult = { added: computed.added, skipped: computed.skipped };
    return computed.state;
  });
  return { state, ...lastResult };
}

export function removePlayer(sessionId: string, playerId: string) {
  return mutateGameState(sessionId, (s) => computeRemovePlayer(s, playerId));
}

/**
 * プレイヤー情報を更新する。
 *
 * 名前変更時は session レベルの **`participants` / `admins` / `createdBy`** も
 * 同一トランザクション内で旧名→新名へ置換する。これらは名前ベースの参照のため、
 * 同期更新しないと SessionJoinPage の入室判定 / 管理者権限 / 作成者判定が
 * 古い名前を指したまま壊れる（renamed プレイヤーが「未入室」表示になる等）。
 */
export async function updatePlayer(
  sessionId: string,
  playerId: string,
  updates: Omit<Partial<Player>, 'id'>,
): Promise<GameState> {
  const _db = requireDb();
  const ref = doc(_db, 'sessions', sessionId);

  try {
    return await runTransaction(_db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) {
        throw new SessionError('セッションが見つかりません', 'not-found');
      }
      const data = snap.data();
      const remote = data.gameState as GameState | undefined;
      if (!remote) {
        throw new SessionError('セッションの状態が初期化されていません', 'invalid-state');
      }

      const oldName = remote.players.find((p) => p.id === playerId)?.name;
      const next = computeUpdatePlayer(remote, playerId, updates);
      const newName = next.players.find((p) => p.id === playerId)?.name;

      const payload: Record<string, unknown> = buildGameStatePayload(next);

      if (oldName && newName && oldName !== newName) {
        const participants = data.participants as string[] | undefined;
        if (participants?.includes(oldName)) {
          payload.participants = participants.map((n) => (n === oldName ? newName : n));
        }
        const admins = data.admins as string[] | undefined;
        if (admins?.includes(oldName)) {
          payload.admins = admins.map((n) => (n === oldName ? newName : n));
        }
        if (data.createdBy === oldName) {
          payload.createdBy = newName;
        }
      }

      transaction.update(ref, payload);
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

export function resetAllCourts(sessionId: string) {
  return mutateGameState(sessionId, computeResetAllCourts);
}

export function clearPlayers(sessionId: string) {
  return mutateGameState(sessionId, computeClearPlayers);
}

export function clearHistory(sessionId: string) {
  return mutateGameState(sessionId, computeClearHistory);
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
  const now = Date.now();
  return mutateGameState(sessionId, (s) =>
    computeAddReservation(s, playerIds, id, now, createdBy),
  );
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

/**
 * 試合状態をまとめてリセットする（SettingsPage「試合をリセット」）。
 * コートクリア / 全員休憩 / 履歴消去 / 予約消去 を **1 transaction** で実行し、
 * 途中で失敗してもコートだけ消えて履歴が残るような中途半端な状態にならないようにする。
 */
export function resetMatchState(sessionId: string) {
  return mutateGameState(sessionId, (s) =>
    computeClearReservations(
      computeClearHistory(computeSetAllPlayersResting(computeResetAllCourts(s))),
    ),
  );
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

export function setLateBalanceMode(sessionId: string, value: boolean) {
  return mutateGameState(sessionId, (s) => computeSetSetting(s, 'lateBalanceMode', value));
}

export function setReservationBlockThreshold(sessionId: string, value: number) {
  return mutateGameState(sessionId, (s) => computeSetSetting(s, 'reservationBlockThreshold', value));
}

/**
 * 90 分自動オンの実行をマークする。`lateBalanceAutoFired` が既に true なら no-op。
 * 未発火時は `lateBalanceMode=true` と `lateBalanceAutoFired=true` を 1 transaction
 * で書き込む。idempotent なので複数クライアントが同時に発火しても安全。
 *
 * 手動で `setLateBalanceMode` を呼んでも `lateBalanceAutoFired` は変えない。
 * 「自動オンが動いたか」は手動操作とは独立した一回限りのイベント。
 */
export function markLateBalanceAutoFired(sessionId: string) {
  return mutateGameState(sessionId, (s) => {
    if (s.settings?.lateBalanceAutoFired) return s;
    return {
      ...s,
      settings: {
        ...(s.settings ?? {}),
        lateBalanceMode: true,
        lateBalanceAutoFired: true,
      },
    };
  });
}

// =============================================================================
// Match: 汎用 update（B2/B4 修正で追加）
// =============================================================================

/**
 * `matchHistory` の特定 match を partial update する。
 * `updateMatchScore` よりも汎用的で、`teamA` / `teamB` の swap や `winner` の
 * リセットも 1 transaction で行える。
 */
export function updateMatch(
  sessionId: string,
  matchId: string,
  updates: Omit<Partial<Match>, 'id'>,
) {
  return mutateGameState(sessionId, (state) => ({
    ...state,
    matchHistory: state.matchHistory.map((m) =>
      m.id === matchId ? { ...m, ...updates, id: m.id } : m,
    ),
  }));
}

// =============================================================================
// Composite operations
// =============================================================================

/**
 * Auto-assign で複数のコート更新と予約消化を **1 transaction** で実行する。
 *
 * 旧実装は writer.fulfillReservation × N + writer.updateCourt × M を sequential
 * await していたため、N+M 回の round-trip + 中間状態の露出があった。
 * これを単一 transaction にまとめてアトミックにする（H4）。
 */
export interface AutoAssignSpec {
  courtId: number;
  teamA: [string, string];
  teamB: [string, string];
  isPlaying: boolean;
  startedAt: number;
  /** 休憩中から予約で呼び出したメンバー。出場のため isResting=false にする。 */
  activatePlayerIds?: string[];
}

export function autoAssignAndFulfill(
  sessionId: string,
  assignments: AutoAssignSpec[],
  fulfilledReservationIds: string[],
  now: number = Date.now(),
) {
  return mutateGameState(sessionId, (state) => {
    let next = state;
    for (const id of fulfilledReservationIds) {
      next = computeFulfillReservation(next, id, now);
    }
    for (const a of assignments) {
      next = computeUpdateCourt(next, a.courtId, {
        teamA: a.teamA,
        teamB: a.teamB,
        scoreA: 0,
        scoreB: 0,
        isPlaying: a.isPlaying,
        startedAt: a.startedAt,
        finishedAt: 0,
      });
      for (const pid of a.activatePlayerIds ?? []) {
        next = computeUpdatePlayer(next, pid, { isResting: false });
      }
    }
    return next;
  });
}

/**
 * コート上のプレイヤーを入れ替える処理を **1 transaction** にまとめる（CON2）。
 * 休憩中プレイヤーを入れた場合は isResting=false にする（コート上で休憩状態の
 * 不整合を防ぐ）。試合後の復帰は computeFinishAndContinue の統一ルール
 * （未成立予約があれば休憩、無ければ待機）に委ねる。
 */
export function swapPlayer(
  sessionId: string,
  courtId: number,
  position: 0 | 1 | 2 | 3,
  newPlayerId: string,
) {
  return mutateGameState(sessionId, (state) => {
    const court = state.courts.find((c) => c.id === courtId);
    if (!court) return state;

    const newTeamA: [string, string] = [court.teamA[0], court.teamA[1]];
    const newTeamB: [string, string] = [court.teamB[0], court.teamB[1]];
    if (position === 0 || position === 1) {
      newTeamA[position] = newPlayerId;
    } else {
      // position === 2 || 3
      newTeamB[(position - 2) as 0 | 1] = newPlayerId;
    }

    const newPlayer = state.players.find((p) => p.id === newPlayerId);

    let next: GameState = computeUpdateCourt(state, courtId, {
      teamA: newTeamA,
      teamB: newTeamB,
    });
    if (newPlayer?.isResting) {
      next = computeUpdatePlayer(next, newPlayerId, { isResting: false });
    }
    return next;
  });
}

/**
 * 2 つのコート位置 (courtId, position) を入れ替える。同一コート内 / 異コート間の
 * どちらにも対応し、**1 transaction** で実行する（CON5）。
 *
 * 旧実装 (`MainPage.handlePlayerTap`) はローカル `courts` を読んで `updateCourt`
 * を 2 回 await していたため:
 *   - 異コート間スワップで 1 回目成功 / 2 回目失敗時に同じプレイヤーが両コート
 *     に存在する（または片方が消える）状態になる。
 *   - リモートが間に変わるとローカルの古い teamA/teamB を上書きし、他端末の
 *     スワップを巻き戻すレースがあった。
 *
 * フレッシュなリモート状態を読んでスワップを計算するのでレース耐性もある。
 */
export function swapPositions(
  sessionId: string,
  posA: { courtId: number; position: 0 | 1 | 2 | 3 },
  posB: { courtId: number; position: 0 | 1 | 2 | 3 },
) {
  return mutateGameState(sessionId, (state) => {
    const courtA = state.courts.find((c) => c.id === posA.courtId);
    const courtB = state.courts.find((c) => c.id === posB.courtId);
    if (!courtA || !courtB) return state;

    const getSlot = (c: Court, pos: 0 | 1 | 2 | 3): string =>
      pos === 0 || pos === 1 ? c.teamA[pos] : c.teamB[(pos - 2) as 0 | 1];
    const withSlot = (
      teamA: [string, string],
      teamB: [string, string],
      pos: 0 | 1 | 2 | 3,
      value: string,
    ): { teamA: [string, string]; teamB: [string, string] } => {
      const ta: [string, string] = [teamA[0], teamA[1]];
      const tb: [string, string] = [teamB[0], teamB[1]];
      if (pos === 0 || pos === 1) ta[pos] = value;
      else tb[(pos - 2) as 0 | 1] = value;
      return { teamA: ta, teamB: tb };
    };

    const playerAtA = getSlot(courtA, posA.position);
    const playerAtB = getSlot(courtB, posB.position);

    if (posA.courtId === posB.courtId) {
      // 同一コート: 両ポジションを 1 回の computeUpdateCourt で更新
      const step1 = withSlot(courtA.teamA, courtA.teamB, posA.position, playerAtB);
      const step2 = withSlot(step1.teamA, step1.teamB, posB.position, playerAtA);
      return computeUpdateCourt(state, posA.courtId, {
        teamA: step2.teamA,
        teamB: step2.teamB,
      });
    }

    const updatedA = withSlot(courtA.teamA, courtA.teamB, posA.position, playerAtB);
    const updatedB = withSlot(courtB.teamA, courtB.teamB, posB.position, playerAtA);
    let next = computeUpdateCourt(state, posA.courtId, {
      teamA: updatedA.teamA,
      teamB: updatedA.teamB,
    });
    next = computeUpdateCourt(next, posB.courtId, {
      teamA: updatedB.teamA,
      teamB: updatedB.teamB,
    });
    return next;
  });
}

/**
 * `gameState.courts` のリサイズ + `session.config.courtCount` を **1 transaction** で
 * 同期更新する（H6）。旧実装は 2 回の write でアトミック性が失われていた。
 */
export async function resizeCourtsWithConfig(
  sessionId: string,
  count: number,
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

      const next = computeResizeCourts(remote, count);
      transaction.update(ref, {
        ...buildGameStatePayload(next),
        'config.courtCount': count,
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
// Composite operations: 試合終了
// =============================================================================

export interface FinishGameOptions {
  matchId: string;
  useStayDurationPriority: boolean;
  prioritizeDiversity: boolean;
  /**
   * true のとき、連続モードが ON でも次の試合を自動配置しない
   * （15 分超過の自動終了用）。
   */
  skipContinuous?: boolean;
}

/**
 * 試合終了 + 連続モード配置を 1 transaction で実行する。
 *
 * `startedAt` をべき等キーとして二重終了を防ぐ。リモート側で既に終了済み
 * （isPlaying=false または startedAt が変わっている）の場合は `already_finished`
 * を返し、書き込みは行わない。
 *
 * 既存の `sessionService.finishGameTransaction` の置き換え版。
 * `gameStore.finishGame`（楽観更新版）と区別するため、composite であることを
 * 明示する名前にしている。
 *
 * 設定（continuousMatchMode / practiceType）はリモート状態を優先採用する。
 */
export async function finishMatchAndContinue(
  sessionId: string,
  courtId: number,
  matchStartedAt: number,
  options: FinishGameOptions,
): Promise<{
  result: 'success' | 'already_finished';
  writtenState?: GameState;
  /** 連続モード配置の結果（成功 / ブロック理由）。GAMEOPS4: 呼び出し側で toast 表示用。 */
  continuousNextApplied?: boolean;
  continuousError?: string;
}> {
  if (matchStartedAt <= 0) {
    throw new SessionError(
      'matchStartedAt が無効です（試合が開始されていません）',
      'invalid-arg',
    );
  }

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
      const computed = computeFinishAndContinue(remote, courtId, {
        continuousMatchMode: remoteSettings?.continuousMatchMode ?? false,
        useStayDurationPriority: options.useStayDurationPriority,
        prioritizeDiversity: options.prioritizeDiversity,
        gameMode,
        matchId: options.matchId,
        lateBalanceMode: remoteSettings?.lateBalanceMode ?? false,
        reservationBlockThreshold: remoteSettings?.reservationBlockThreshold,
        skipContinuous: options.skipContinuous,
      });

      transaction.update(ref, buildGameStatePayload(computed.newState));

      return {
        result: 'success' as const,
        writtenState: computed.newState,
        continuousNextApplied: computed.continuousNextApplied,
        continuousError: computed.continuousError,
      };
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
