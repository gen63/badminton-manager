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

/**
 * 会費・名簿が両方完了になった時刻を set-once でセットする。
 * `opsCompletedAt` は滞在時間モードの優先度算出の起点として使われるため、
 * 一度セットしたら誤操作（OFF→ON し直し等）で上書き・リセットしない。
 */
function withOpsCompletedAt(
  prev: Player,
  nextStatus: NonNullable<Player['operationStatus']>,
  now: number,
): Pick<Player, 'opsCompletedAt'> | Record<string, never> {
  if (prev.opsCompletedAt !== undefined) return {};
  if (!nextStatus.payment || !nextStatus.roster) return {};
  return { opsCompletedAt: now };
}

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
  // - court.restingPlayerIds から除外
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
      restingPlayerIds: (c.restingPlayerIds ?? []).filter((id) => id !== playerId),
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

/**
 * field を単純トグルする。payment に使う場合、金額 (paymentAmount) は変更しない。
 * 誤って支払い登録した状態を未登録に戻す操作に使う（金額修正は computeApplyPayment を使う）。
 */
export function computeToggleOperationStatus(
  state: GameState,
  playerId: string,
  field: 'payment' | 'roster' | 'checkin',
  now: number = Date.now(),
  operatorName?: string,
): GameState {
  return {
    ...state,
    players: state.players.map((p) => {
      if (p.id !== playerId) return p;
      const current = p.operationStatus ?? DEFAULT_OP_STATUS;
      const nextStatus = { ...current, [field]: !current[field] };
      const updates: Partial<Player> = {
        operationStatus: nextStatus,
        ...withOpsCompletedAt(p, nextStatus, now),
      };
      if (field === 'payment' && nextStatus.payment) {
        updates.paymentTimestamp = now;
        updates.paymentOperatorName = operatorName;
      }
      return { ...p, ...updates };
    }),
  };
}

/**
 * 支払い金額を登録・修正する。常に payment: true にする（トグルしない）。
 * 既に支払い済みの状態で呼んでも「未登録」には戻らず、金額だけが更新される
 * （¥1200→¥1000 のような一発修正を可能にするため）。誤登録を取り消して
 * 未登録に戻したい場合は `toggleOperationStatus(sessionId, playerId, 'payment')`
 * を使う（こちらは金額を変更しない単純トグル）。
 * paymentTimestamp は未払い→支払いへの遷移時のみ更新し、金額修正では保持する。
 */
export function computeApplyPayment(
  state: GameState,
  playerId: string,
  amount: number,
  now: number = Date.now(),
  operatorName?: string,
): GameState {
  return {
    ...state,
    players: state.players.map((p) => {
      if (p.id !== playerId) return p;
      const current = p.operationStatus ?? DEFAULT_OP_STATUS;
      const wasPaid = current.payment;
      const nextStatus = { ...current, payment: true };
      const updates: Partial<Player> = {
        paymentAmount: amount,
        operationStatus: nextStatus,
        ...withOpsCompletedAt(p, nextStatus, now),
      };
      if (!wasPaid) {
        updates.paymentTimestamp = now;
        updates.paymentOperatorName = operatorName;
      }
      return { ...p, ...updates };
    }),
  };
}

/** 会費・名簿未対応メンバーを強制休憩にするまでの猶予時間（ms）。最初の試合終了が起点。 */
export const FORCED_REST_GRACE_MS = 30 * 60 * 1000;

/** 会費・名簿の未対応項目。空配列 = 対応済み。 */
export function unresolvedOpsOf(p: Player): ('payment' | 'roster')[] {
  const unresolved: ('payment' | 'roster')[] = [];
  if (!p.operationStatus?.payment) unresolved.push('payment');
  if (!p.operationStatus?.roster) unresolved.push('roster');
  return unresolved;
}

/**
 * 会費・名簿未対応メンバーの強制休憩を計算する。共通の除外条件（すべて AND）:
 *   - 会費（payment）または名簿（roster）が未対応
 *   - コート上にいない（試合中のメンバーは引き剥がさず、試合終了後の
 *     次回チェックで対象化する）
 *
 * その上で「初回」と「再発火」の 2 経路で判定する:
 *   - **初回**（`forcedRestAt` 未セット）: 最初の出場試合を終えてから
 *     `FORCED_REST_GRACE_MS` 以上経過で発火（matchHistory 中の本人出場試合の
 *     最古 finishedAt が起点。試合未消化なら対象外）。
 *   - **再発火**（`forcedRestAt` セット済み）: 未対応が解消されないまま、前回の
 *     強制休憩（`forcedRestAt`）より後に終了した本人出場試合が 1 つでもあれば
 *     発火する（= ボーダー超過後にもう 1 試合こなした）。「毎試合ごと」に
 *     休憩にするため猶予は課さない。発火時に `forcedRestAt` を now へ更新する
 *     ことで、その試合は次回チェックでは「前回休憩より前」になり毎分連打を防ぐ。
 *
 * 対象者は `isResting: true` + `forcedRestAt: now`。既に休憩中でもマーカーを
 * セットして `enforced` に含める（元々休憩でも全員通知は行う仕様のため）。
 */
export function computeEnforceForcedRest(
  state: GameState,
  now: number = Date.now(),
): { state: GameState; enforced: Player[] } {
  const playingIds = new Set(
    state.courts.flatMap((c) => [...c.teamA, ...c.teamB]).filter((pid) => pid),
  );
  // 各プレイヤーの最初 / 最新の試合終了時刻
  const firstFinishedAt = new Map<string, number>();
  const lastFinishedAt = new Map<string, number>();
  for (const m of state.matchHistory) {
    if (!m.finishedAt) continue;
    for (const pid of [...m.teamA, ...m.teamB]) {
      if (!pid) continue;
      const first = firstFinishedAt.get(pid);
      if (first === undefined || m.finishedAt < first) firstFinishedAt.set(pid, m.finishedAt);
      const last = lastFinishedAt.get(pid);
      if (last === undefined || m.finishedAt > last) lastFinishedAt.set(pid, m.finishedAt);
    }
  }

  const enforced: Player[] = [];
  const players = state.players.map((p) => {
    if (unresolvedOpsOf(p).length === 0) return p;
    if (playingIds.has(p.id)) return p;
    if (p.forcedRestAt) {
      // 再発火: 前回の強制休憩より後に終えた試合があれば毎試合ごとに再休憩。
      const last = lastFinishedAt.get(p.id);
      if (last === undefined || last <= p.forcedRestAt) return p;
    } else {
      // 初回: 最初の出場試合終了から猶予経過で休憩。
      const baseline = firstFinishedAt.get(p.id);
      if (baseline === undefined || now - baseline < FORCED_REST_GRACE_MS) return p;
    }
    const next = { ...p, isResting: true, forcedRestAt: now };
    enforced.push(next);
    return next;
  });
  if (enforced.length === 0) return { state, enforced };
  return { state: { ...state, players }, enforced };
}

/** 結果未登録試合の出場者を強制休憩にするまでの猶予時間（ms）。試合終了が起点。 */
export const UNRECORDED_REST_GRACE_MS = 10 * 60 * 1000;

/**
 * 結果未登録の強制休憩が発動する未登録試合数の下限。1 試合だけなら
 * 「直後でこれから入力する」可能性が高いので静観し、溜まり始めたら発動する。
 */
export const UNRECORDED_REST_MIN_COUNT = 2;

/** 勝敗未入力の判定（HistoryPage / unrecordedMatchPrompt の判定式と同一に保つ） */
function isUnrecordedMatch(m: Match): boolean {
  return m.scoreA === 0 && m.scoreB === 0 && !m.winner;
}

/**
 * 結果未登録試合の出場者の強制休憩を計算する。勝敗記録モード
 * （settings.recordScores === true）で、かつ未登録試合が
 * `UNRECORDED_REST_MIN_COUNT`（2）試合以上溜まっているときのみ動作する
 * （マーカー済み・猶予内の未登録試合も「溜まっている」数には含む）。
 * 対象試合の条件（すべて AND）:
 *   - 勝敗未入力（scoreA===0 && scoreB===0 && !winner）
 *   - `match.forcedRestAt` 未セット（べき等マーカー。1 試合につき 1 度だけ発火）
 *   - 試合終了から `UNRECORDED_REST_GRACE_MS` 以上経過
 *
 * 対象試合にマーカーをセットし、出場者のうちコート上にいないメンバーを
 * 休憩にする（試合中のメンバーは引き剥がさない。全員が試合中でも通知の
 * ためにマーカーはセットする）。結果が登録されれば条件から外れるので、
 * 同じメンバーが別の試合を未登録にすれば改めて発火する（試合単位）。
 */
export function computeEnforceUnrecordedRest(
  state: GameState,
  now: number = Date.now(),
): { state: GameState; enforcedMatches: Match[] } {
  if (state.settings?.recordScores !== true) return { state, enforcedMatches: [] };

  const unrecorded = state.matchHistory.filter(
    (m) => isUnrecordedMatch(m) && m.finishedAt > 0,
  );
  if (unrecorded.length < UNRECORDED_REST_MIN_COUNT) return { state, enforcedMatches: [] };

  const overdueIds = new Set(
    unrecorded
      .filter((m) => !m.forcedRestAt && now - m.finishedAt >= UNRECORDED_REST_GRACE_MS)
      .map((m) => m.id),
  );
  if (overdueIds.size === 0) return { state, enforcedMatches: [] };

  const playingIds = new Set(
    state.courts.flatMap((c) => [...c.teamA, ...c.teamB]).filter((pid) => pid),
  );
  const matchHistory = state.matchHistory.map((m) =>
    overdueIds.has(m.id) ? { ...m, forcedRestAt: now } : m,
  );
  const participantIds = new Set(
    matchHistory
      .filter((m) => overdueIds.has(m.id))
      .flatMap((m) => [...m.teamA, ...m.teamB])
      .filter((pid) => pid),
  );
  const players = state.players.map((p) =>
    participantIds.has(p.id) && !playingIds.has(p.id) && !p.isResting
      ? { ...p, isResting: true }
      : p,
  );

  return {
    state: { ...state, players, matchHistory },
    enforcedMatches: matchHistory.filter((m) => overdueIds.has(m.id)),
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

/**
 * 配置後の自動開始（`MATCH_AUTO_START_MS` 超過）を計算する。
 * 開始時刻は **配置時刻 (`assignedAt`) そのもの**（自動開始が走った時刻ではない）。
 *
 * 自動開始してはいけない状態（配置が無い / 既に開始済み / 別の配置に差し替わって
 * いる）のときは `null` を返し、呼び出し側は書き込みを行わない。
 * `assignedAt` をべき等キーとして扱うため、複数端末が同時に発火しても
 * 1 度だけ成功する。
 */
export function computeAutoStartGame(
  state: GameState,
  courtId: number,
  assignedAt: number,
): GameState | null {
  if (assignedAt <= 0) return null;
  const court = state.courts.find((c) => c.id === courtId);
  if (!court) return null;
  if (court.isPlaying) return null;
  if (!court.teamA[0]) return null;
  if ((court.assignedAt ?? 0) !== assignedAt) return null;
  return computeUpdateCourt(state, courtId, { isPlaying: true, startedAt: assignedAt });
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

/**
 * 名簿に存在しない ID（＝削除されてしまったプレイヤー）を指しているスロットか。
 * 空文字は「3人試合の空きスロット」なので対象外（表示は同じ「未設定」だが別物）。
 */
export function isOrphanPlayerId(state: GameState, playerId: string): boolean {
  return playerId !== '' && !state.players.some((p) => p.id === playerId);
}

/** その orphan ID が出場している履歴の試合数 */
export function countOrphanMatches(matchHistory: Match[], orphanId: string): number {
  if (!orphanId) return 0;
  return matchHistory.filter((m) => [...m.teamA, ...m.teamB].includes(orphanId)).length;
}

/**
 * 履歴に取り残された ID（削除されたプレイヤー）を現在のメンバーに割り当て直す。
 *
 * 同期が試合開始後にメンバーを削除していた時期の事故で、`matchHistory` に ID だけが
 * 残り「未設定」と表示される。試合記録そのもの（スコア・時刻・勝敗）は無事なので、
 * ID を本人へ差し替えれば履歴・成績・勝率がすべて元に戻る。
 *
 * **正しい記録を書き換えられないための不変条件**:
 * - `orphanId` が現在の名簿に居る場合は **no-op**。つまり「今いるメンバーの試合を
 *   別人に書き換える」経路は存在しない。UI 側のガードではなくここで担保する。
 * - 置換すると同じ試合に `newPlayerId` が2回現れてしまう試合はスキップする
 *   （既にその試合に出ている人へは寄せられない）。
 *
 * `matchId` 指定でその試合だけ、未指定なら全試合＋コート・予約の参照も差し替える。
 * `gamesPlayed` / `lastPlayedAt` は `recomputePlayerMatchStats` で履歴と整合させる。
 */
export function computeAssignOrphanPlayer(
  state: GameState,
  orphanId: string,
  newPlayerId: string,
  matchId?: string,
): GameState {
  if (!isOrphanPlayerId(state, orphanId)) return state;
  if (!state.players.some((p) => p.id === newPlayerId)) return state;

  const swapPair = (pair: [string, string]): [string, string] => [
    pair[0] === orphanId ? newPlayerId : pair[0],
    pair[1] === orphanId ? newPlayerId : pair[1],
  ];

  const matchHistory = state.matchHistory.map((m) => {
    if (matchId != null && m.id !== matchId) return m;
    if (![...m.teamA, ...m.teamB].includes(orphanId)) return m;
    // 置換で同一試合内に重複が生じる場合は触らない
    if ([...m.teamA, ...m.teamB].includes(newPlayerId)) return m;
    return { ...m, teamA: swapPair(m.teamA), teamB: swapPair(m.teamB) };
  });

  // 単一試合の修正ではコート・予約に触れない（その試合の記録だけを直す操作なので）
  const targetsAll = matchId == null;
  const courts = targetsAll
    ? state.courts.map((c) =>
        [...c.teamA, ...c.teamB].includes(newPlayerId)
          ? c
          : {
              ...c,
              teamA: swapPair(c.teamA),
              teamB: swapPair(c.teamB),
              ...(c.restingPlayerIds && {
                restingPlayerIds: [
                  ...new Set(c.restingPlayerIds.map((id) => (id === orphanId ? newPlayerId : id))),
                ],
              }),
            },
      )
    : state.courts;
  const reservations = targetsAll
    ? state.reservations.map((r) => ({
        ...r,
        playerIds: [...new Set(r.playerIds.map((id) => (id === orphanId ? newPlayerId : id)))],
      }))
    : state.reservations;

  return {
    ...state,
    players: recomputePlayerMatchStats(state.players, matchHistory),
    matchHistory,
    courts,
    reservations,
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
  operatorName?: string,
) {
  return mutateGameState(sessionId, (s) =>
    computeToggleOperationStatus(s, playerId, field, undefined, operatorName),
  );
}

export function applyPayment(
  sessionId: string,
  playerId: string,
  amount: number,
  operatorName?: string,
) {
  return mutateGameState(sessionId, (s) =>
    computeApplyPayment(s, playerId, amount, undefined, operatorName),
  );
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

export function resetAllCourts(sessionId: string) {
  return mutateGameState(sessionId, computeResetAllCourts);
}

export function clearPlayers(sessionId: string) {
  return mutateGameState(sessionId, computeClearPlayers);
}

export function clearHistory(sessionId: string) {
  return mutateGameState(sessionId, computeClearHistory);
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

/**
 * 履歴に取り残された ID を現在のメンバーへ割り当て直す（履歴画面の「未設定」修復）。
 * `matchId` 未指定＝その ID の全試合をまとめて修復する。
 */
export function assignOrphanPlayer(
  sessionId: string,
  orphanId: string,
  newPlayerId: string,
  matchId?: string,
) {
  return mutateGameState(sessionId, (s) =>
    computeAssignOrphanPlayer(s, orphanId, newPlayerId, matchId),
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

/**
 * 練習種別を更新する。単＝`forceBulkAssignment` false 固定 / 楽＝true 固定という不変条件を
 * ここで導出し、同一 transaction で一緒に書き込む（呼び出し側に導出させない）。
 * 複は `forceBulkAssignment` を触らず既存値を維持する。
 */
export function setPracticeType(sessionId: string, value: '単' | '複' | '楽') {
  return mutateGameState(sessionId, (s) => {
    const next = computeSetSetting(s, 'practiceType', value);
    if (value === '単') return computeSetSetting(next, 'forceBulkAssignment', false);
    if (value === '楽') return computeSetSetting(next, 'forceBulkAssignment', true);
    return next;
  });
}

export function setLateBalanceMode(sessionId: string, value: boolean) {
  return mutateGameState(sessionId, (s) => computeSetSetting(s, 'lateBalanceMode', value));
}

export function setUseStayDurationPriority(sessionId: string, value: boolean) {
  return mutateGameState(sessionId, (s) =>
    computeSetSetting(s, 'useStayDurationPriority', value),
  );
}

export function setForceBulkAssignment(sessionId: string, value: boolean) {
  return mutateGameState(sessionId, (s) =>
    computeSetSetting(s, 'forceBulkAssignment', value),
  );
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

/**
 * 未対応（会費・名簿）メンバーと結果未登録試合の出場者の強制休憩を
 * **1 transaction** で実施する。対象がいなければ **書き込まずに** 返す
 * （定期チェックから全端末が毎分呼んでも無駄な write / updatedAt 更新をしない）。
 *
 * `forcedRestAt` マーカー（Player / Match）がべき等キーとして働くため、複数端末が
 * 同時に呼んでも実際に書き込むのは 1 端末だけになる。`now` はクロージャで 1 度
 * だけ生成し、transaction リトライ時も同じ値を使う（idempotent）。
 */
export async function enforceForcedRest(
  sessionId: string,
): Promise<{ enforced: Player[]; enforcedMatches: Match[] }> {
  const _db = requireDb();
  const ref = doc(_db, 'sessions', sessionId);
  const now = Date.now();

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

      const ops = computeEnforceForcedRest(remote, now);
      const unrecorded = computeEnforceUnrecordedRest(ops.state, now);
      const result = {
        enforced: ops.enforced,
        enforcedMatches: unrecorded.enforcedMatches,
      };
      if (result.enforced.length === 0 && result.enforcedMatches.length === 0) {
        return result;
      }

      transaction.update(ref, buildGameStatePayload(unrecorded.state));
      return result;
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
  /** 配置時刻。未開始のまま `MATCH_AUTO_START_MS` を超えたときの自動開始の基準。 */
  assignedAt: number;
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
        assignedAt: a.assignedAt,
        finishedAt: 0,
        // 新しい試合の配置なので、前の試合の「休憩へ戻す」フラグは持ち越さない
        restingPlayerIds: [],
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
 * 不整合を防ぐ）。このとき未成立予約に含まれないメンバー（= 手動休憩）は
 * `court.restingPlayerIds` に積み、試合終了時に休憩へ戻す。予約で休憩中の
 * メンバーは積まず、computeFinishAndContinue の予約ルール（全員出場で予約消化
 * → 待機、未成立予約が残れば休憩）に委ねる。
 * 外れたメンバーが restingPlayerIds に含まれる場合は、その場で休憩へ戻す。
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
    const outgoingId =
      position === 0 || position === 1
        ? court.teamA[position]
        : court.teamB[(position - 2) as 0 | 1];
    if (position === 0 || position === 1) {
      newTeamA[position] = newPlayerId;
    } else {
      // position === 2 || 3
      newTeamB[(position - 2) as 0 | 1] = newPlayerId;
    }

    const newPlayer = state.players.find((p) => p.id === newPlayerId);

    let restingPlayerIds = court.restingPlayerIds ?? [];
    const restoreOutgoing =
      outgoingId !== '' &&
      outgoingId !== newPlayerId &&
      restingPlayerIds.includes(outgoingId);
    if (restoreOutgoing) {
      restingPlayerIds = restingPlayerIds.filter((id) => id !== outgoingId);
    }
    if (newPlayer?.isResting && !restingPlayerIds.includes(newPlayerId)) {
      const pendingReservedIds = new Set(
        state.reservations
          .filter((r) => r.status === 'pending')
          .flatMap((r) => r.playerIds),
      );
      if (!pendingReservedIds.has(newPlayerId)) {
        restingPlayerIds = [...restingPlayerIds, newPlayerId];
      }
    }

    let next: GameState = computeUpdateCourt(state, courtId, {
      teamA: newTeamA,
      teamB: newTeamB,
      restingPlayerIds,
    });
    if (newPlayer?.isResting) {
      next = computeUpdatePlayer(next, newPlayerId, { isResting: false });
    }
    if (restoreOutgoing) {
      next = computeUpdatePlayer(next, outgoingId, { isResting: true });
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

    // 「試合後に休憩へ戻す」フラグはプレイヤーと一緒に移動先コートへ引き継ぐ
    const restA = courtA.restingPlayerIds ?? [];
    const restB = courtB.restingPlayerIds ?? [];
    const moveAtoB = playerAtA !== '' && restA.includes(playerAtA);
    const moveBtoA = playerAtB !== '' && restB.includes(playerAtB);
    const newRestA = [
      ...(moveAtoB ? restA.filter((id) => id !== playerAtA) : restA),
      ...(moveBtoA ? [playerAtB] : []),
    ];
    const newRestB = [
      ...(moveBtoA ? restB.filter((id) => id !== playerAtB) : restB),
      ...(moveAtoB ? [playerAtA] : []),
    ];

    let next = computeUpdateCourt(state, posA.courtId, {
      teamA: updatedA.teamA,
      teamB: updatedA.teamB,
      restingPlayerIds: newRestA,
    });
    next = computeUpdateCourt(next, posB.courtId, {
      teamA: updatedB.teamA,
      teamB: updatedB.teamB,
      restingPlayerIds: newRestB,
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
// Composite operations: 試合開始
// =============================================================================

/**
 * 配置後 `MATCH_AUTO_START_MS` を超えたコートを自動的に試合開始にする。
 *
 * `assignedAt` をべき等キーとして二重開始を防ぐ。リモート側で既に開始済み
 * （手動「開始」が押された / 他端末が先に自動開始した）、コートがクリアされた、
 * 別の配置に差し替わっている場合は `already_started` を返し、書き込みは行わない。
 *
 * 開始時刻は自動開始が走った時刻ではなく **配置時刻** を採用する
 * （＝配置したタイミングを試合開始とみなす）。
 */
export async function autoStartMatch(
  sessionId: string,
  courtId: number,
  assignedAt: number,
): Promise<{ result: 'success' | 'already_started' }> {
  if (assignedAt <= 0) {
    throw new SessionError('assignedAt が無効です（配置されていません）', 'invalid-arg');
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

      const next = computeAutoStartGame(remote, courtId, assignedAt);
      if (!next) return { result: 'already_started' as const };

      transaction.update(ref, buildGameStatePayload(next));
      return { result: 'success' as const };
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
  forceBulkAssignment: boolean;
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
 * 設定（continuousMatchMode / practiceType / useStayDurationPriority /
 * forceBulkAssignment）と練習開始日時（config.practiceStartTime）はリモート状態を
 * 優先採用する。
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
      // 練習開始日時はセッション設定。同じ snapshot から読めるので追加 read は不要。
      // 待機時間優先モードの滞在時間算出に必須（欠損時のみ従来どおり now 相当）。
      const remoteConfig = snap.data().config as { practiceStartTime?: number } | undefined;
      const computed = computeFinishAndContinue(remote, courtId, {
        continuousMatchMode: remoteSettings?.continuousMatchMode ?? false,
        // 配置モードはセッション設定を優先。リモート未設定の旧セッションのみ、
        // 呼び出し側（端末ローカル設定）の値にフォールバックする。
        useStayDurationPriority:
          remoteSettings?.useStayDurationPriority ?? options.useStayDurationPriority,
        // forceBulkAssignment も同様にセッション設定を優先。リモート未設定の旧セッションの
        // みクライアントの値にフォールバックする。
        forceBulkAssignment:
          remoteSettings?.forceBulkAssignment ?? options.forceBulkAssignment,
        gameMode,
        matchId: options.matchId,
        lateBalanceMode: remoteSettings?.lateBalanceMode ?? false,
        reservationBlockThreshold: remoteSettings?.reservationBlockThreshold,
        practiceStartTime: remoteConfig?.practiceStartTime,
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
