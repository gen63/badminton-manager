import { describe, it, expect, beforeEach, vi } from 'vitest';

// =============================================================================
// Firestore mocks（wrapper テスト用）
// =============================================================================

const mockTransactionGet = vi.fn();
const mockTransactionUpdate = vi.fn();
const mockTransaction = { get: mockTransactionGet, update: mockTransactionUpdate };
const mockRunTransaction = vi.fn(async (_db: unknown, cb: (tx: typeof mockTransaction) => unknown) =>
  cb(mockTransaction),
);

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('firebase/firestore');
  return {
    ...actual,
    runTransaction: (db: unknown, cb: (tx: typeof mockTransaction) => unknown) =>
      mockRunTransaction(db, cb),
    doc: vi.fn(() => ({ __docRef: true })),
    serverTimestamp: () => '__serverTimestamp__',
  };
});

vi.mock('../lib/firebase', () => ({
  db: { __mockDb: true },
}));

import {
  computeAddPlayers,
  computeRemovePlayer,
  computeUpdatePlayer,
  computeToggleRest,
  computeToggleOperationStatus,
  computeApplyPayment,
  computeIncrementGamesPlayed,
  computeSetAllPlayersResting,
  computeInitializeCourts,
  computeResizeCourts,
  computeRemoveCourt,
  computeUpdateCourt,
  computeStartGame,
  computeClearCourt,
  computeResetAllCourts,
  computeClearPlayers,
  computeClearHistory,
  computeAddMatch,
  computeRemoveMatch,
  computeUpdateMatchScore,
  computeAddReservation,
  computeRemoveReservation,
  computeFulfillReservation,
  computeClearReservations,
  computeSetSetting,
  applyPayment,
  addPlayers,
  finishMatchAndContinue,
  overwriteGameState,
  updateMatch,
  updatePlayer,
  autoAssignAndFulfill,
  resizeCourtsWithConfig,
  swapPlayer,
  swapPositions,
  markLateBalanceAutoFired,
  computeEnforceForcedRest,
  computeEnforceUnrecordedRest,
  enforceForcedRest,
  unresolvedOpsOf,
  FORCED_REST_GRACE_MS,
  UNRECORDED_REST_GRACE_MS,
} from './sessionMutations';
import type { GameState } from './sessionService';
import type { Player } from '../types/player';
import type { Court } from '../types/court';
import type { Match } from '../types/match';
import { SessionError } from '../lib/errorHandler';

const makePlayer = (id: string, overrides: Partial<Player> = {}): Player => ({
  id,
  name: `Player ${id}`,
  isResting: false,
  gamesPlayed: 0,
  lastPlayedAt: 0,
  activatedAt: 0,
  ...overrides,
});

const makeCourt = (id: number, overrides: Partial<Court> = {}): Court => ({
  id,
  teamA: ['', ''],
  teamB: ['', ''],
  scoreA: 0,
  scoreB: 0,
  isPlaying: false,
  startedAt: 0,
  finishedAt: 0,
  ...overrides,
});

const makeMatch = (id: string, overrides: Partial<Match> = {}): Match => ({
  id,
  courtId: 1,
  teamA: ['p1', 'p2'],
  teamB: ['p3', 'p4'],
  scoreA: 0,
  scoreB: 0,
  startedAt: 1000,
  finishedAt: 2000,
  ...overrides,
});

const baseState = (overrides: Partial<GameState> = {}): GameState => ({
  players: [],
  courts: [],
  matchHistory: [],
  reservations: [],
  ...overrides,
});

describe('sessionMutations - players', () => {
  describe('computeAddPlayers', () => {
    it('新規追加し、id を生成済みリストから引き当てる', () => {
      const state = baseState();
      const { state: next, added, skipped } = computeAddPlayers(
        state,
        [{ name: 'Alice' }, { name: 'Bob' }],
        ['id-a', 'id-b'],
      );
      expect(added).toBe(2);
      expect(skipped).toEqual([]);
      expect(next.players).toHaveLength(2);
      expect(next.players[0]).toMatchObject({ id: 'id-a', name: 'Alice', isResting: true });
      expect(next.players[1]).toMatchObject({ id: 'id-b', name: 'Bob', isResting: true });
    });

    it('既存名と重複したら skipped に積む', () => {
      const state = baseState({ players: [makePlayer('1', { name: 'Alice' })] });
      const result = computeAddPlayers(state, [{ name: 'Alice' }, { name: 'Bob' }], ['x', 'y']);
      expect(result.added).toBe(1);
      expect(result.skipped).toEqual(['Alice']);
      expect(result.state.players).toHaveLength(2);
    });

    it('入力内重複も skipped', () => {
      const result = computeAddPlayers(
        baseState(),
        [{ name: 'Alice' }, { name: 'Alice' }],
        ['x', 'y'],
      );
      expect(result.added).toBe(1);
      expect(result.skipped).toEqual(['Alice']);
    });

    it('空文字 / 空白だけの名前はスキップ（skipped にも積まない）', () => {
      const result = computeAddPlayers(
        baseState(),
        [{ name: '' }, { name: '   ' }, { name: 'Bob' }],
        ['x', 'y', 'z'],
      );
      expect(result.added).toBe(1);
      expect(result.skipped).toEqual([]);
      expect(result.state.players[0].id).toBe('z');
    });
  });

  it('computeRemovePlayer', () => {
    const state = baseState({ players: [makePlayer('a'), makePlayer('b')] });
    const next = computeRemovePlayer(state, 'a');
    expect(next.players.map((p) => p.id)).toEqual(['b']);
  });

  it('computeRemovePlayer: コート上のプレイヤー参照を空にする (DATA1)', () => {
    const state = baseState({
      players: [makePlayer('a'), makePlayer('b'), makePlayer('c'), makePlayer('d')],
      courts: [
        makeCourt(1, {
          teamA: ['a', 'b'],
          teamB: ['c', 'd'],
        }),
      ],
    });
    const next = computeRemovePlayer(state, 'a');
    expect(next.courts[0].teamA).toEqual(['', 'b']);
    expect(next.courts[0].teamB).toEqual(['c', 'd']);
  });

  it('computeRemovePlayer: 予約から削除し、空になった予約は破棄 (DATA1)', () => {
    const state = baseState({
      players: [makePlayer('a'), makePlayer('b')],
      reservations: [
        { id: 'r1', orderNumber: 1, playerIds: ['a', 'b'], status: 'pending', createdAt: 0, fulfilledAt: 0 },
        { id: 'r2', orderNumber: 2, playerIds: ['a'], status: 'pending', createdAt: 0, fulfilledAt: 0 },
      ],
    });
    const next = computeRemovePlayer(state, 'a');
    // r1 は b だけ残る
    expect(next.reservations.find((r) => r.id === 'r1')?.playerIds).toEqual(['b']);
    // r2 は空になるので破棄
    expect(next.reservations.find((r) => r.id === 'r2')).toBeUndefined();
  });

  it('computeUpdatePlayer', () => {
    const state = baseState({ players: [makePlayer('a', { name: 'Alice' })] });
    const next = computeUpdatePlayer(state, 'a', { name: 'Alice2', gender: 'F' });
    expect(next.players[0]).toMatchObject({ name: 'Alice2', gender: 'F' });
  });

  describe('computeToggleRest', () => {
    it('isResting:true → false かつ activatedAt が 0 なら now を入れる', () => {
      const state = baseState({
        players: [makePlayer('a', { isResting: true, activatedAt: 0 })],
      });
      const next = computeToggleRest(state, 'a', 5000);
      expect(next.players[0].isResting).toBe(false);
      expect(next.players[0].activatedAt).toBe(5000);
    });

    it('既に activatedAt がある場合は維持', () => {
      const state = baseState({
        players: [makePlayer('a', { isResting: true, activatedAt: 1000 })],
      });
      const next = computeToggleRest(state, 'a', 9999);
      expect(next.players[0].activatedAt).toBe(1000);
    });

    it('isResting:false → true は activatedAt を変えない', () => {
      const state = baseState({
        players: [makePlayer('a', { isResting: false, activatedAt: 1000 })],
      });
      const next = computeToggleRest(state, 'a', 9999);
      expect(next.players[0].isResting).toBe(true);
      expect(next.players[0].activatedAt).toBe(1000);
    });
  });

  describe('computeToggleOperationStatus', () => {
    it('payment OFF → ON で paymentTimestamp を更新', () => {
      const state = baseState({
        players: [makePlayer('a', { operationStatus: { payment: false, roster: false, checkin: false } })],
      });
      const next = computeToggleOperationStatus(state, 'a', 'payment', 5000);
      expect(next.players[0].operationStatus?.payment).toBe(true);
      expect(next.players[0].paymentTimestamp).toBe(5000);
    });

    it('payment ON → OFF では paymentTimestamp を消さない（履歴保持）', () => {
      const state = baseState({
        players: [makePlayer('a', {
          operationStatus: { payment: true, roster: false, checkin: false },
          paymentTimestamp: 1000,
        })],
      });
      const next = computeToggleOperationStatus(state, 'a', 'payment', 9999);
      expect(next.players[0].operationStatus?.payment).toBe(false);
      expect(next.players[0].paymentTimestamp).toBe(1000);
    });

    it('roster トグルは paymentTimestamp を変えない', () => {
      const state = baseState({
        players: [makePlayer('a', { operationStatus: { payment: false, roster: false, checkin: false } })],
      });
      const next = computeToggleOperationStatus(state, 'a', 'roster', 5000);
      expect(next.players[0].operationStatus).toEqual({ payment: false, roster: true, checkin: false });
      expect(next.players[0].paymentTimestamp).toBeUndefined();
    });

    it('operationStatus が未設定でもデフォルトから始められる', () => {
      const state = baseState({ players: [makePlayer('a')] });
      const next = computeToggleOperationStatus(state, 'a', 'checkin', 5000);
      expect(next.players[0].operationStatus).toEqual({
        payment: false,
        roster: false,
        checkin: true,
      });
    });

    it('payment OFF → ON で operatorName を渡すと paymentOperatorName がセットされる', () => {
      const state = baseState({
        players: [makePlayer('a', { operationStatus: { payment: false, roster: false, checkin: false } })],
      });
      const next = computeToggleOperationStatus(state, 'a', 'payment', 5000, '太郎');
      expect(next.players[0].paymentOperatorName).toBe('太郎');
    });

    it('payment OFF → ON で operatorName を渡さない場合 paymentOperatorName はセットされない', () => {
      const state = baseState({
        players: [makePlayer('a', { operationStatus: { payment: false, roster: false, checkin: false } })],
      });
      const next = computeToggleOperationStatus(state, 'a', 'payment', 5000);
      expect(next.players[0].paymentOperatorName).toBeUndefined();
    });

    it('payment ON → OFF（revert）では paymentOperatorName を変更しない', () => {
      const state = baseState({
        players: [makePlayer('a', {
          operationStatus: { payment: true, roster: false, checkin: false },
          paymentTimestamp: 1000,
          paymentOperatorName: '太郎',
        })],
      });
      const next = computeToggleOperationStatus(state, 'a', 'payment', 9999, '花子');
      expect(next.players[0].operationStatus?.payment).toBe(false);
      expect(next.players[0].paymentOperatorName).toBe('太郎');
    });

    it('回帰: OFF→ON→revert→再度 ON（operatorName 未指定）で古い paymentOperatorName が残らない', () => {
      // 太郎が支払い登録 → 取り消し（revert）→ 裏管理（operatorName 無し）で再登録。
      // paymentTimestamp は更新されるが paymentOperatorName が stale な '太郎' のまま
      // 残ってはいけない（AccountingPage での誤帰属を防ぐ）。
      const state = baseState({
        players: [makePlayer('a', { operationStatus: { payment: false, roster: false, checkin: false } })],
      });
      const paid = computeToggleOperationStatus(state, 'a', 'payment', 1000, '太郎');
      expect(paid.players[0].paymentOperatorName).toBe('太郎');

      const reverted = computeToggleOperationStatus(paid, 'a', 'payment', 2000, '太郎');
      expect(reverted.players[0].operationStatus?.payment).toBe(false);

      const rePaid = computeToggleOperationStatus(reverted, 'a', 'payment', 3000);
      expect(rePaid.players[0].operationStatus?.payment).toBe(true);
      expect(rePaid.players[0].paymentTimestamp).toBe(3000);
      expect(rePaid.players[0].paymentOperatorName).toBeUndefined();
    });
  });

  describe('computeApplyPayment', () => {
    it('paymentAmount + payment OFF→ON + paymentTimestamp を 1 ステップで', () => {
      const state = baseState({
        players: [makePlayer('a', { operationStatus: { payment: false, roster: false, checkin: false } })],
      });
      const next = computeApplyPayment(state, 'a', 800, 5000);
      expect(next.players[0]).toMatchObject({
        paymentAmount: 800,
        paymentTimestamp: 5000,
        operationStatus: { payment: true, roster: false, checkin: false },
      });
    });

    it('支払い済みへの再適用は payment を ON のまま維持し金額のみ更新する（トグルしない）', () => {
      const state = baseState({
        players: [makePlayer('a', {
          operationStatus: { payment: true, roster: false, checkin: false },
          paymentAmount: 1200,
          paymentTimestamp: 1000,
        })],
      });
      const next = computeApplyPayment(state, 'a', 1000, 9999);
      expect(next.players[0].operationStatus?.payment).toBe(true);
      expect(next.players[0].paymentTimestamp).toBe(1000);
      expect(next.players[0].paymentAmount).toBe(1000);
    });

    it('免除（0円）を適用しても payment は ON になる', () => {
      const state = baseState({
        players: [makePlayer('a', { operationStatus: { payment: false, roster: false, checkin: false } })],
      });
      const next = computeApplyPayment(state, 'a', 0, 5000);
      expect(next.players[0].operationStatus?.payment).toBe(true);
      expect(next.players[0].paymentAmount).toBe(0);
      expect(next.players[0].paymentTimestamp).toBe(5000);
    });

    it('未払い→支払いへの遷移時に operatorName を渡すと paymentOperatorName がセットされる', () => {
      const state = baseState({
        players: [makePlayer('a', { operationStatus: { payment: false, roster: false, checkin: false } })],
      });
      const next = computeApplyPayment(state, 'a', 800, 5000, '太郎');
      expect(next.players[0].paymentOperatorName).toBe('太郎');
    });

    it('未払い→支払いへの遷移時に operatorName を渡さない場合 paymentOperatorName はセットされない', () => {
      const state = baseState({
        players: [makePlayer('a', { operationStatus: { payment: false, roster: false, checkin: false } })],
      });
      const next = computeApplyPayment(state, 'a', 800, 5000);
      expect(next.players[0].paymentOperatorName).toBeUndefined();
    });

    it('金額修正（既に支払い済み）では operatorName を渡しても paymentOperatorName は既存値を保持する', () => {
      const state = baseState({
        players: [makePlayer('a', {
          operationStatus: { payment: true, roster: false, checkin: false },
          paymentAmount: 1200,
          paymentTimestamp: 1000,
          paymentOperatorName: '太郎',
        })],
      });
      const next = computeApplyPayment(state, 'a', 1000, 9999, '花子');
      expect(next.players[0].paymentAmount).toBe(1000);
      expect(next.players[0].paymentOperatorName).toBe('太郎');
    });
  });

  describe('computeIncrementGamesPlayed', () => {
    it('指定 ID 群の gamesPlayed を +1、lastPlayedAt 更新', () => {
      const state = baseState({
        players: [
          makePlayer('a', { gamesPlayed: 5 }),
          makePlayer('b', { gamesPlayed: 7 }),
          makePlayer('c', { gamesPlayed: 1 }),
        ],
      });
      const next = computeIncrementGamesPlayed(state, ['a', 'c'], 9000);
      expect(next.players.find((p) => p.id === 'a')).toMatchObject({ gamesPlayed: 6, lastPlayedAt: 9000 });
      expect(next.players.find((p) => p.id === 'b')).toMatchObject({ gamesPlayed: 7, lastPlayedAt: 0 });
      expect(next.players.find((p) => p.id === 'c')).toMatchObject({ gamesPlayed: 2, lastPlayedAt: 9000 });
    });

    it('空 ID 配列なら state を変えない（参照同一）', () => {
      const state = baseState({ players: [makePlayer('a', { gamesPlayed: 5 })] });
      const next = computeIncrementGamesPlayed(state, [], 9000);
      expect(next).toBe(state);
    });
  });

  it('computeSetAllPlayersResting: 全員 isResting=true', () => {
    const state = baseState({
      players: [
        makePlayer('a', { isResting: false }),
        makePlayer('b', { isResting: false }),
      ],
    });
    const next = computeSetAllPlayersResting(state);
    expect(next.players.every((p) => p.isResting)).toBe(true);
  });
});

describe('sessionMutations - courts', () => {
  it('computeInitializeCourts: 連番 id で空コートを生成', () => {
    const state = baseState();
    const next = computeInitializeCourts(state, 3);
    expect(next.courts).toHaveLength(3);
    expect(next.courts.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(next.courts.every((c) => c.isPlaying === false)).toBe(true);
  });

  describe('computeResizeCourts', () => {
    it('増やす: 既存を保持し末尾追加', () => {
      const state = baseState({
        courts: [makeCourt(1, { teamA: ['p1', 'p2'] })],
      });
      const next = computeResizeCourts(state, 3);
      expect(next.courts).toHaveLength(3);
      expect(next.courts[0].teamA).toEqual(['p1', 'p2']);
      expect(next.courts[1].id).toBe(2);
      expect(next.courts[2].id).toBe(3);
    });

    it('減らす: 使用中コートを優先保持して空きを末尾から削る', () => {
      const state = baseState({
        courts: [
          makeCourt(1),
          makeCourt(2, { teamA: ['p1', 'p2'], isPlaying: true }),
          makeCourt(3),
        ],
      });
      const next = computeResizeCourts(state, 2);
      expect(next.courts).toHaveLength(2);
      const ids = next.courts.map((c) => c.id).sort();
      expect(ids).toEqual([1, 2]);
      // 使用中だった court は ID 1 に振り直されて残る
      expect(next.courts.some((c) => c.isPlaying)).toBe(true);
    });

    it('使用中コートが新規定数を超える場合は使用中のみ保持', () => {
      const state = baseState({
        courts: [
          makeCourt(1, { teamA: ['p1', 'p2'], isPlaying: true }),
          makeCourt(2, { teamA: ['p3', 'p4'], isPlaying: true }),
        ],
      });
      const next = computeResizeCourts(state, 1);
      expect(next.courts).toHaveLength(1);
      expect(next.courts[0].isPlaying).toBe(true);
    });
  });

  it('computeRemoveCourt: 削除後 ID を 1 から振り直す', () => {
    const state = baseState({ courts: [makeCourt(1), makeCourt(2), makeCourt(3)] });
    const next = computeRemoveCourt(state, 2);
    expect(next.courts.map((c) => c.id)).toEqual([1, 2]);
  });

  it('computeUpdateCourt: 部分更新', () => {
    const state = baseState({ courts: [makeCourt(1)] });
    const next = computeUpdateCourt(state, 1, { teamA: ['p1', 'p2'] });
    expect(next.courts[0].teamA).toEqual(['p1', 'p2']);
  });

  it('computeStartGame: isPlaying=true + startedAt', () => {
    const state = baseState({ courts: [makeCourt(1, { teamA: ['p1', 'p2'] })] });
    const next = computeStartGame(state, 1, 5000);
    expect(next.courts[0].isPlaying).toBe(true);
    expect(next.courts[0].startedAt).toBe(5000);
  });

  it('computeClearCourt: チームと状態をリセット', () => {
    const state = baseState({
      courts: [
        makeCourt(1, {
          teamA: ['p1', 'p2'],
          teamB: ['p3', 'p4'],
          isPlaying: true,
          startedAt: 1000,
        }),
      ],
    });
    const next = computeClearCourt(state, 1);
    expect(next.courts[0]).toMatchObject({
      teamA: ['', ''],
      teamB: ['', ''],
      isPlaying: false,
      startedAt: 0,
    });
  });

  it('computeResetAllCourts: 全コートを空状態にする', () => {
    const state = baseState({
      courts: [
        makeCourt(1, {
          teamA: ['p1', 'p2'],
          teamB: ['p3', 'p4'],
          isPlaying: true,
          startedAt: 1000,
        }),
        makeCourt(2, { teamA: ['p5', 'p6'] }),
      ],
    });
    const next = computeResetAllCourts(state);
    expect(next.courts).toHaveLength(2);
    expect(next.courts.every((c) => !c.isPlaying && c.teamA[0] === '' && c.teamB[0] === '')).toBe(true);
    // ID は維持
    expect(next.courts.map((c) => c.id)).toEqual([1, 2]);
  });

  it('computeClearPlayers: 全プレイヤーを削除', () => {
    const state = baseState({
      players: [makePlayer('a'), makePlayer('b')],
      courts: [makeCourt(1)],
    });
    const next = computeClearPlayers(state);
    expect(next.players).toEqual([]);
    // 他のフィールドは保持
    expect(next.courts).toHaveLength(1);
  });
});

describe('sessionMutations - match history', () => {
  it('computeAddMatch: 末尾追加', () => {
    const state = baseState({ matchHistory: [makeMatch('m1')] });
    const next = computeAddMatch(state, makeMatch('m2'));
    expect(next.matchHistory.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('computeRemoveMatch', () => {
    const state = baseState({ matchHistory: [makeMatch('m1'), makeMatch('m2')] });
    const next = computeRemoveMatch(state, 'm1');
    expect(next.matchHistory.map((m) => m.id)).toEqual(['m2']);
  });

  it('computeRemoveMatch: 残った履歴から gamesPlayed / lastPlayedAt を再計算する', () => {
    // 整合した初期状態: m1(t=1000) a,b vs c,d / m2(t=2000) a,b vs c,e
    const state = baseState({
      players: [
        makePlayer('a', { gamesPlayed: 2, lastPlayedAt: 2000 }),
        makePlayer('b', { gamesPlayed: 2, lastPlayedAt: 2000 }),
        makePlayer('c', { gamesPlayed: 2, lastPlayedAt: 2000 }),
        makePlayer('d', { gamesPlayed: 1, lastPlayedAt: 1000 }),
        makePlayer('e', { gamesPlayed: 1, lastPlayedAt: 2000 }),
      ],
      matchHistory: [
        makeMatch('m1', { teamA: ['a', 'b'], teamB: ['c', 'd'], finishedAt: 1000 }),
        makeMatch('m2', { teamA: ['a', 'b'], teamB: ['c', 'e'], finishedAt: 2000 }),
      ],
    });
    const next = computeRemoveMatch(state, 'm2');
    // m1 のみ残る → a,b,c,d は 1 試合 (lastPlayedAt=1000)、e は 0 試合
    expect(next.players.find((p) => p.id === 'a')).toMatchObject({ gamesPlayed: 1, lastPlayedAt: 1000 });
    expect(next.players.find((p) => p.id === 'b')).toMatchObject({ gamesPlayed: 1, lastPlayedAt: 1000 });
    expect(next.players.find((p) => p.id === 'c')).toMatchObject({ gamesPlayed: 1, lastPlayedAt: 1000 });
    expect(next.players.find((p) => p.id === 'd')).toMatchObject({ gamesPlayed: 1, lastPlayedAt: 1000 });
    // e は唯一の試合 m2 を消されたので lastPlayedAt も 0 に戻る
    expect(next.players.find((p) => p.id === 'e')).toMatchObject({ gamesPlayed: 0, lastPlayedAt: 0 });
  });

  it('computeRemoveMatch: 存在しない ID なら統計を変えない', () => {
    const state = baseState({
      players: [makePlayer('a', { gamesPlayed: 1, lastPlayedAt: 2000 })],
      matchHistory: [makeMatch('m1', { teamA: ['a', 'b'], teamB: ['c', 'd'], finishedAt: 2000 })],
    });
    const next = computeRemoveMatch(state, 'nope');
    expect(next.players.find((p) => p.id === 'a')).toMatchObject({ gamesPlayed: 1, lastPlayedAt: 2000 });
    expect(next.matchHistory.map((m) => m.id)).toEqual(['m1']);
  });

  it('computeUpdateMatchScore: スコアと winner を更新', () => {
    const state = baseState({ matchHistory: [makeMatch('m1', { scoreA: 0, scoreB: 0 })] });
    const next = computeUpdateMatchScore(state, 'm1', 21, 19, 'A');
    expect(next.matchHistory[0]).toMatchObject({ scoreA: 21, scoreB: 19, winner: 'A' });
  });

  it('computeUpdateMatchScore: winner 未指定時は既存 winner を保持（消さない）', () => {
    const state = baseState({
      matchHistory: [makeMatch('m1', { scoreA: 21, scoreB: 19, winner: 'A' })],
    });
    const next = computeUpdateMatchScore(state, 'm1', 21, 18);
    expect(next.matchHistory[0]).toMatchObject({ scoreA: 21, scoreB: 18, winner: 'A' });
  });

  it('computeClearHistory: matchHistory を空にし、他フィールドは保持', () => {
    const state = baseState({
      matchHistory: [makeMatch('m1'), makeMatch('m2')],
      // 統計再計算が isResting 等の他フィールドを壊さないことを確認
      // （resetMatchState の合成で setAllPlayersResting と併用するため重要）
      players: [makePlayer('a', { isResting: true })],
    });
    const next = computeClearHistory(state);
    expect(next.matchHistory).toEqual([]);
    expect(next.players).toHaveLength(1);
    expect(next.players[0].isResting).toBe(true);
  });

  it('computeClearHistory: 全プレイヤーの gamesPlayed / lastPlayedAt を 0 に戻す', () => {
    const state = baseState({
      matchHistory: [
        makeMatch('m1', { teamA: ['a', 'b'], teamB: ['c', 'd'], finishedAt: 1000 }),
        makeMatch('m2', { teamA: ['a', 'c'], teamB: ['e', 'f'], finishedAt: 2000 }),
      ],
      players: [
        makePlayer('a', { gamesPlayed: 2, lastPlayedAt: 2000 }),
        makePlayer('b', { gamesPlayed: 1, lastPlayedAt: 1000 }),
        makePlayer('c', { gamesPlayed: 2, lastPlayedAt: 2000 }),
      ],
    });
    const next = computeClearHistory(state);
    // 履歴が空 → 全員 0 / 0
    expect(next.players.find((p) => p.id === 'a')).toMatchObject({ gamesPlayed: 0, lastPlayedAt: 0 });
    expect(next.players.find((p) => p.id === 'b')).toMatchObject({ gamesPlayed: 0, lastPlayedAt: 0 });
    expect(next.players.find((p) => p.id === 'c')).toMatchObject({ gamesPlayed: 0, lastPlayedAt: 0 });
  });
});

describe('sessionMutations - reservations', () => {
  it('computeAddReservation: orderNumber は max+1', () => {
    const state = baseState({
      players: [makePlayer('p1'), makePlayer('p2'), makePlayer('p3')],
      reservations: [
        { id: 'r1', orderNumber: 5, playerIds: ['p1'], status: 'pending', createdAt: 0, fulfilledAt: 0 },
      ],
    });
    const next = computeAddReservation(state, ['p2', 'p3'], 'r2', 1000, 'admin');
    expect(next.reservations).toHaveLength(2);
    expect(next.reservations[1]).toMatchObject({
      id: 'r2',
      orderNumber: 6,
      playerIds: ['p2', 'p3'],
      status: 'pending',
      createdAt: 1000,
      fulfilledAt: 0,
      createdBy: 'admin',
    });
  });

  it('computeAddReservation: 重複 ID / 存在しない ID / 空文字を弾く (DATA4)', () => {
    const state = baseState({
      players: [makePlayer('p1'), makePlayer('p2')],
    });
    const next = computeAddReservation(
      state,
      ['p1', 'p1', 'ghost', '', 'p2'],
      'r1',
      1000,
    );
    expect(next.reservations).toHaveLength(1);
    expect(next.reservations[0].playerIds).toEqual(['p1', 'p2']);
  });

  it('computeAddReservation: 全部無効なら no-op', () => {
    const state = baseState({ players: [makePlayer('p1')] });
    const next = computeAddReservation(state, ['ghost', ''], 'r1', 1000);
    expect(next).toBe(state);
  });

  it('computeAddReservation: 待機メンバーを休憩にする（プレイ中は据え置き）', () => {
    const state = baseState({
      players: [makePlayer('p1'), makePlayer('p2'), makePlayer('p3')],
      courts: [makeCourt(1, { teamA: ['p3', ''], isPlaying: true })],
    });
    const next = computeAddReservation(state, ['p1', 'p2', 'p3'], 'r1', 1000);
    expect(next.players.find((p) => p.id === 'p1')?.isResting).toBe(true);
    expect(next.players.find((p) => p.id === 'p2')?.isResting).toBe(true);
    // プレイ中の p3 は休憩にしない（試合後に finish 側で休憩へ）
    expect(next.players.find((p) => p.id === 'p3')?.isResting).toBe(false);
  });

  it('computeRemoveReservation: 自動休憩したメンバーを待機へ戻す（他予約に無ければ）', () => {
    const state = baseState({
      players: [
        makePlayer('p1', { isResting: true, activatedAt: 0 }),
        makePlayer('p2', { isResting: true }),
      ],
      reservations: [
        { id: 'r1', orderNumber: 1, playerIds: ['p1', 'p2'], status: 'pending', createdAt: 0, fulfilledAt: 0 },
        { id: 'r2', orderNumber: 2, playerIds: ['p2'], status: 'pending', createdAt: 0, fulfilledAt: 0 },
      ],
    });
    const next = computeRemoveReservation(state, 'r1', 5000);
    expect(next.reservations.map((r) => r.id)).toEqual(['r2']);
    // p1 は他予約に無い → 待機へ。activatedAt が 0 なら now で埋める
    expect(next.players.find((p) => p.id === 'p1')?.isResting).toBe(false);
    expect(next.players.find((p) => p.id === 'p1')?.activatedAt).toBe(5000);
    // p2 はまだ r2 に居る → 休憩のまま
    expect(next.players.find((p) => p.id === 'p2')?.isResting).toBe(true);
  });

  it('computeRemoveReservation', () => {
    const state = baseState({
      reservations: [
        { id: 'r1', orderNumber: 1, playerIds: ['p1'], status: 'pending', createdAt: 0, fulfilledAt: 0 },
      ],
    });
    const next = computeRemoveReservation(state, 'r1');
    expect(next.reservations).toEqual([]);
  });

  it('computeFulfillReservation', () => {
    const state = baseState({
      reservations: [
        { id: 'r1', orderNumber: 1, playerIds: ['p1'], status: 'pending', createdAt: 0, fulfilledAt: 0 },
      ],
    });
    const next = computeFulfillReservation(state, 'r1', 5000);
    expect(next.reservations[0]).toMatchObject({ status: 'fulfilled', fulfilledAt: 5000 });
  });

  it('computeClearReservations', () => {
    const state = baseState({
      reservations: [
        { id: 'r1', orderNumber: 1, playerIds: ['p1'], status: 'pending', createdAt: 0, fulfilledAt: 0 },
      ],
    });
    const next = computeClearReservations(state);
    expect(next.reservations).toEqual([]);
  });
});

describe('sessionMutations - settings', () => {
  it('computeSetSetting: 既存値を保持して指定キーのみ更新', () => {
    const state = baseState({ settings: { recordScores: true, practiceType: '複' } });
    const next = computeSetSetting(state, 'practiceType', '単');
    expect(next.settings).toEqual({ recordScores: true, practiceType: '単' });
  });

  it('computeSetSetting: settings 未定義でも作成', () => {
    const state = baseState();
    const next = computeSetSetting(state, 'recordScores', false);
    expect(next.settings).toEqual({ recordScores: false });
  });
});

describe('sessionMutations - markLateBalanceAutoFired', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunTransaction.mockImplementation(async (_db, cb) => cb(mockTransaction));
  });

  it('未発火 (autoFired=false) のときは mode=true と autoFired=true を書き込む', async () => {
    const state = baseState({ settings: { lateBalanceMode: false } });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    await markLateBalanceAutoFired('session-1');

    expect(mockTransactionUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockTransactionUpdate.mock.calls[0][1];
    expect(updateArgs.gameState.settings).toMatchObject({
      lateBalanceMode: true,
      lateBalanceAutoFired: true,
    });
  });

  it('既に発火済み (autoFired=true) のときは no-op', async () => {
    const state = baseState({
      settings: { lateBalanceMode: false, lateBalanceAutoFired: true },
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    await markLateBalanceAutoFired('session-1');

    expect(mockTransactionUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockTransactionUpdate.mock.calls[0][1];
    // autoFired は既に true、mode は false のまま (no-op)
    expect(updateArgs.gameState.settings).toMatchObject({
      lateBalanceMode: false,
      lateBalanceAutoFired: true,
    });
  });

  it('settings 未定義でも初期化して書き込む', async () => {
    const state = baseState();
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    await markLateBalanceAutoFired('session-1');

    const updateArgs = mockTransactionUpdate.mock.calls[0][1];
    expect(updateArgs.gameState.settings).toEqual({
      lateBalanceMode: true,
      lateBalanceAutoFired: true,
    });
  });

  it('既存の他の settings (practiceType 等) を保持しつつ書き込む', async () => {
    const state = baseState({
      settings: { practiceType: '複', recordScores: true, lateBalanceMode: false },
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    await markLateBalanceAutoFired('session-1');

    const updateArgs = mockTransactionUpdate.mock.calls[0][1];
    expect(updateArgs.gameState.settings).toMatchObject({
      practiceType: '複',
      recordScores: true,
      lateBalanceMode: true,
      lateBalanceAutoFired: true,
    });
  });
});

// =============================================================================
// 会費・名簿未対応メンバーの強制休憩
// =============================================================================

describe('computeEnforceForcedRest', () => {
  const NOW = 10_000_000_000;
  // 猶予時間を十分過ぎた「最初の試合終了」時刻
  const FIRST_FINISHED = NOW - FORCED_REST_GRACE_MS - 60_000;

  // p1 が最初の試合を FIRST_FINISHED に終えている履歴
  const historyFor = (playerId: string, finishedAt = FIRST_FINISHED): Match[] => [
    makeMatch('m1', { teamA: [playerId, 'x1'], teamB: ['x2', 'x3'], finishedAt }),
  ];

  const unresolvedPlayer = (id: string, overrides: Partial<Player> = {}): Player =>
    makePlayer(id, {
      gamesPlayed: 1,
      operationStatus: { payment: false, roster: true, checkin: true },
      ...overrides,
    });

  it('会費未払い + 最初の試合終了から猶予経過で強制休憩 + マーカーをセットする', () => {
    const state = baseState({
      players: [unresolvedPlayer('p1')],
      matchHistory: historyFor('p1'),
    });
    const { state: next, enforced } = computeEnforceForcedRest(state, NOW);
    expect(enforced.map((p) => p.id)).toEqual(['p1']);
    expect(next.players[0]).toMatchObject({
      isResting: true,
      forcedRestAt: NOW,
    });
  });

  it('名簿未対応（会費は支払い済み）でも対象になる', () => {
    const state = baseState({
      players: [
        unresolvedPlayer('p1', {
          operationStatus: { payment: true, roster: false, checkin: true },
        }),
      ],
      matchHistory: historyFor('p1'),
    });
    const { enforced } = computeEnforceForcedRest(state, NOW);
    expect(enforced.map((p) => p.id)).toEqual(['p1']);
  });

  it('会費・名簿とも対応済みのプレイヤーは対象外', () => {
    const state = baseState({
      players: [
        unresolvedPlayer('p1', {
          operationStatus: { payment: true, roster: true, checkin: true },
        }),
      ],
      matchHistory: historyFor('p1'),
    });
    const { state: next, enforced } = computeEnforceForcedRest(state, NOW);
    expect(enforced).toEqual([]);
    expect(next).toBe(state);
  });

  it('試合を 1 度も終えていないプレイヤーは対象外', () => {
    const state = baseState({
      players: [unresolvedPlayer('p1')],
      matchHistory: [],
    });
    const { enforced } = computeEnforceForcedRest(state, NOW);
    expect(enforced).toEqual([]);
  });

  it('最初の試合終了から猶予時間が経過していないプレイヤーは対象外', () => {
    const state = baseState({
      players: [unresolvedPlayer('p1')],
      matchHistory: historyFor('p1', NOW - FORCED_REST_GRACE_MS + 1),
    });
    const { enforced } = computeEnforceForcedRest(state, NOW);
    expect(enforced).toEqual([]);
  });

  it('起点は「最初の」試合終了時刻（直近ではない）', () => {
    // 1 試合目は猶予超過、2 試合目は直近 → 1 試合目起点なので対象
    const state = baseState({
      players: [unresolvedPlayer('p1', { gamesPlayed: 2 })],
      matchHistory: [
        makeMatch('m2', { teamA: ['p1', 'x1'], teamB: ['x2', 'x3'], finishedAt: NOW - 60_000 }),
        makeMatch('m1', { teamA: ['p1', 'x1'], teamB: ['x2', 'x3'], finishedAt: FIRST_FINISHED }),
      ],
    });
    const { enforced } = computeEnforceForcedRest(state, NOW);
    expect(enforced.map((p) => p.id)).toEqual(['p1']);
  });

  it('コート上（試合中）のプレイヤーは引き剥がさない（マーカーもセットしない）', () => {
    const state = baseState({
      players: [unresolvedPlayer('p1')],
      matchHistory: historyFor('p1'),
      courts: [makeCourt(1, { teamA: ['p1', 'p2'], teamB: ['p3', 'p4'], isPlaying: true })],
    });
    const { state: next, enforced } = computeEnforceForcedRest(state, NOW);
    expect(enforced).toEqual([]);
    expect(next.players[0].forcedRestAt).toBeUndefined();
    expect(next.players[0].isResting).toBe(false);
  });

  it('既にマーカー付き (forcedRestAt) のプレイヤーには再発火しない', () => {
    const state = baseState({
      players: [unresolvedPlayer('p1', { isResting: true, forcedRestAt: NOW - 60_000 })],
      matchHistory: historyFor('p1'),
    });
    const { state: next, enforced } = computeEnforceForcedRest(state, NOW);
    expect(enforced).toEqual([]);
    expect(next).toBe(state);
  });

  it('元々休憩中でもマーカーをセットして enforced に含める（通知対象）', () => {
    const state = baseState({
      players: [unresolvedPlayer('p1', { isResting: true })],
      matchHistory: historyFor('p1'),
    });
    const { state: next, enforced } = computeEnforceForcedRest(state, NOW);
    expect(enforced.map((p) => p.id)).toEqual(['p1']);
    expect(next.players[0]).toMatchObject({ isResting: true, forcedRestAt: NOW });
  });

  it('operationStatus 未設定（旧データ）は会費・名簿とも未対応として扱う', () => {
    const state = baseState({
      players: [unresolvedPlayer('p1', { operationStatus: undefined })],
      matchHistory: historyFor('p1'),
    });
    const { enforced } = computeEnforceForcedRest(state, NOW);
    expect(enforced.map((p) => p.id)).toEqual(['p1']);
  });
});

describe('unresolvedOpsOf', () => {
  it('未対応の項目だけを返す', () => {
    expect(
      unresolvedOpsOf(
        makePlayer('p1', { operationStatus: { payment: false, roster: true, checkin: true } }),
      ),
    ).toEqual(['payment']);
    expect(
      unresolvedOpsOf(
        makePlayer('p1', { operationStatus: { payment: true, roster: false, checkin: true } }),
      ),
    ).toEqual(['roster']);
    expect(unresolvedOpsOf(makePlayer('p1', { operationStatus: undefined }))).toEqual([
      'payment',
      'roster',
    ]);
    expect(
      unresolvedOpsOf(
        makePlayer('p1', { operationStatus: { payment: true, roster: true, checkin: false } }),
      ),
    ).toEqual([]);
  });
});

describe('computeEnforceUnrecordedRest', () => {
  const NOW = 10_000_000_000;
  // 猶予時間を十分過ぎた試合終了時刻
  const FINISHED = NOW - UNRECORDED_REST_GRACE_MS - 60_000;

  const unrecordedMatch = (id: string, overrides: Partial<Match> = {}): Match =>
    makeMatch(id, {
      teamA: ['p1', 'p2'],
      teamB: ['p3', 'p4'],
      scoreA: 0,
      scoreB: 0,
      winner: undefined,
      finishedAt: FINISHED,
      ...overrides,
    });

  const fourPlayers = () => ['p1', 'p2', 'p3', 'p4'].map((id) => makePlayer(id));

  const recordOn = (overrides: Partial<GameState> = {}): GameState =>
    baseState({ settings: { recordScores: true }, players: fourPlayers(), ...overrides });

  // 「2試合以上溜まっている」条件を満たすためだけの、猶予内の未登録試合
  // （出場者はプレイヤー一覧に存在しない id にして休憩化の対象から外す）
  const fillerUnrecorded = (id = 'filler'): Match =>
    unrecordedMatch(id, {
      teamA: ['x1', 'x2'],
      teamB: ['x3', 'x4'],
      finishedAt: NOW - 60_000,
    });

  it('未登録2試合以上 + 猶予経過で出場者を休憩にし、試合にマーカーをセットする', () => {
    const state = recordOn({ matchHistory: [unrecordedMatch('m1'), fillerUnrecorded()] });
    const { state: next, enforcedMatches } = computeEnforceUnrecordedRest(state, NOW);
    // 猶予超過は m1 だけ（filler は猶予内なのでマーカーはセットされない）
    expect(enforcedMatches.map((m) => m.id)).toEqual(['m1']);
    expect(next.matchHistory[0].forcedRestAt).toBe(NOW);
    expect(next.matchHistory[1].forcedRestAt).toBeUndefined();
    expect(next.players.every((p) => p.isResting)).toBe(true);
  });

  it('未登録が1試合だけなら猶予超過でも発動しない', () => {
    const state = recordOn({ matchHistory: [unrecordedMatch('m1')] });
    const { state: next, enforcedMatches } = computeEnforceUnrecordedRest(state, NOW);
    expect(enforcedMatches).toEqual([]);
    expect(next).toBe(state);
  });

  it('登録済み試合は「溜まっている」数に含まない（未登録1 + 登録済み1 は発動しない）', () => {
    const state = recordOn({
      matchHistory: [unrecordedMatch('m1'), unrecordedMatch('m2', { winner: 'A' })],
    });
    expect(computeEnforceUnrecordedRest(state, NOW).enforcedMatches).toEqual([]);
  });

  it('マーカー済みの未登録試合も「溜まっている」数に含む', () => {
    // m1 は発火済みのまま未登録放置、m2 が新たに猶予超過 → m2 だけ発火
    const state = recordOn({
      matchHistory: [
        unrecordedMatch('m1', { forcedRestAt: NOW - 60 * 60_000 }),
        unrecordedMatch('m2'),
      ],
    });
    const { enforcedMatches } = computeEnforceUnrecordedRest(state, NOW);
    expect(enforcedMatches.map((m) => m.id)).toEqual(['m2']);
  });

  it('勝敗記録モード OFF（false / 未設定）では何もしない', () => {
    const off = recordOn({
      settings: { recordScores: false },
      matchHistory: [unrecordedMatch('m1'), unrecordedMatch('m2')],
    });
    expect(computeEnforceUnrecordedRest(off, NOW).enforcedMatches).toEqual([]);

    const unset = recordOn({
      settings: {},
      matchHistory: [unrecordedMatch('m1'), unrecordedMatch('m2')],
    });
    expect(computeEnforceUnrecordedRest(unset, NOW).enforcedMatches).toEqual([]);
  });

  it('結果登録済み（スコアまたは winner あり）の試合は対象外', () => {
    const state = recordOn({
      matchHistory: [
        unrecordedMatch('m1', { scoreA: 21, scoreB: 15 }),
        unrecordedMatch('m2', { winner: 'A' }),
      ],
    });
    const { state: next, enforcedMatches } = computeEnforceUnrecordedRest(state, NOW);
    expect(enforcedMatches).toEqual([]);
    expect(next).toBe(state);
  });

  it('全試合が猶予時間内なら発動しない', () => {
    const state = recordOn({
      matchHistory: [
        unrecordedMatch('m1', { finishedAt: NOW - UNRECORDED_REST_GRACE_MS + 1 }),
        fillerUnrecorded(),
      ],
    });
    expect(computeEnforceUnrecordedRest(state, NOW).enforcedMatches).toEqual([]);
  });

  it('既にマーカー付きの試合には再発火しない', () => {
    const state = recordOn({
      matchHistory: [
        unrecordedMatch('m1', { forcedRestAt: NOW - 60_000 }),
        unrecordedMatch('m2', { forcedRestAt: NOW - 60_000 }),
      ],
    });
    const { state: next, enforcedMatches } = computeEnforceUnrecordedRest(state, NOW);
    expect(enforcedMatches).toEqual([]);
    expect(next).toBe(state);
  });

  it('コート上（次の試合中）の出場者は引き剥がさないが、マーカーと他メンバーの休憩は行う', () => {
    const state = recordOn({
      matchHistory: [unrecordedMatch('m1'), fillerUnrecorded()],
      courts: [makeCourt(1, { teamA: ['p1', 'x9'], teamB: ['x8', 'x7'], isPlaying: true })],
    });
    const { state: next, enforcedMatches } = computeEnforceUnrecordedRest(state, NOW);
    expect(enforcedMatches.map((m) => m.id)).toEqual(['m1']);
    const byId = new Map(next.players.map((p) => [p.id, p]));
    expect(byId.get('p1')?.isResting).toBe(false); // 試合中
    expect(byId.get('p2')?.isResting).toBe(true);
    expect(byId.get('p3')?.isResting).toBe(true);
    expect(byId.get('p4')?.isResting).toBe(true);
  });

  it('シングルス（空スロットあり）でも出場者だけを休憩にする', () => {
    const state = recordOn({
      matchHistory: [
        unrecordedMatch('m1', { teamA: ['p1', ''], teamB: ['p3', ''] }),
        fillerUnrecorded(),
      ],
    });
    const { state: next } = computeEnforceUnrecordedRest(state, NOW);
    const byId = new Map(next.players.map((p) => [p.id, p]));
    expect(byId.get('p1')?.isResting).toBe(true);
    expect(byId.get('p2')?.isResting).toBe(false);
    expect(byId.get('p3')?.isResting).toBe(true);
    expect(byId.get('p4')?.isResting).toBe(false);
  });
});

describe('enforceForcedRest (wrapper)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunTransaction.mockImplementation(async (_db, cb) => cb(mockTransaction));
  });

  const FIRST_FINISHED = Date.now() - FORCED_REST_GRACE_MS - 60_000;
  const history: Match[] = [
    makeMatch('m1', { teamA: ['p1', 'x1'], teamB: ['x2', 'x3'], finishedAt: FIRST_FINISHED }),
  ];

  it('対象がいれば gameState を書き込み enforced を返す', async () => {
    const state = baseState({
      players: [
        makePlayer('p1', {
          gamesPlayed: 1,
          operationStatus: { payment: false, roster: false, checkin: true },
        }),
      ],
      matchHistory: history,
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    const { enforced } = await enforceForcedRest('session-1');

    expect(enforced.map((p) => p.id)).toEqual(['p1']);
    expect(mockTransactionUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockTransactionUpdate.mock.calls[0][1];
    expect(updateArgs.gameState.players[0]).toMatchObject({
      isResting: true,
      forcedRestAt: expect.any(Number),
    });
  });

  it('対象がいなければ書き込まない（毎分チェックでの無駄 write 抑制）', async () => {
    const state = baseState({
      players: [
        makePlayer('p1', {
          gamesPlayed: 1,
          operationStatus: { payment: true, roster: true, checkin: true },
        }),
      ],
      matchHistory: history,
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    const { enforced, enforcedMatches } = await enforceForcedRest('session-1');

    expect(enforced).toEqual([]);
    expect(enforcedMatches).toEqual([]);
    expect(mockTransactionUpdate).not.toHaveBeenCalled();
  });

  it('結果未登録試合だけが対象でも書き込み、enforcedMatches を返す', async () => {
    const state = baseState({
      settings: { recordScores: true },
      players: [
        makePlayer('p1', {
          gamesPlayed: 1,
          operationStatus: { payment: true, roster: true, checkin: true },
        }),
      ],
      matchHistory: [
        makeMatch('m1', {
          teamA: ['p1', ''],
          teamB: ['x2', ''],
          scoreA: 0,
          scoreB: 0,
          winner: undefined,
          finishedAt: Date.now() - UNRECORDED_REST_GRACE_MS - 60_000,
        }),
        // 「2試合以上溜まっている」条件を満たす猶予内の未登録試合
        makeMatch('m2', {
          teamA: ['x3', ''],
          teamB: ['x4', ''],
          scoreA: 0,
          scoreB: 0,
          winner: undefined,
          finishedAt: Date.now() - 60_000,
        }),
      ],
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    const { enforced, enforcedMatches } = await enforceForcedRest('session-1');

    expect(enforced).toEqual([]);
    expect(enforcedMatches.map((m) => m.id)).toEqual(['m1']);
    expect(mockTransactionUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockTransactionUpdate.mock.calls[0][1];
    expect(updateArgs.gameState.matchHistory[0].forcedRestAt).toEqual(expect.any(Number));
    expect(updateArgs.gameState.players[0].isResting).toBe(true);
  });
});

// =============================================================================
// Wrapper-level tests: mutateGameState の挙動を applyPayment 経由で検証
// =============================================================================

describe('sessionMutations - transactional wrapper (via applyPayment)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunTransaction.mockImplementation(async (_db, cb) => cb(mockTransaction));
  });

  it('成功: snap を読んで apply の結果を update に渡し、戻り値を返す', async () => {
    const state = baseState({
      players: [
        makePlayer('p1', {
          name: 'Alice',
          operationStatus: { payment: false, roster: false, checkin: false },
        }),
        makePlayer('p2', { name: 'Bob' }),
      ],
      matchHistory: [makeMatch('m1', { startedAt: 1000, finishedAt: 2000 })],
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    const result = await applyPayment('session-1', 'p1', 800);

    expect(result.players.find((p) => p.id === 'p1')).toMatchObject({
      paymentAmount: 800,
      operationStatus: { payment: true, roster: false, checkin: false },
    });
    expect(mockTransactionUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockTransactionUpdate.mock.calls[0][1];
    expect(updateArgs.updatedAt).toBe('__serverTimestamp__');
    expect(updateArgs.registeredPlayers).toEqual(['Alice', 'Bob']);
    expect(updateArgs.firstMatchStartedAt).toBe(1000);
    expect(updateArgs.gameState.players).toHaveLength(2);
  });

  it('not-found: snap が存在しないと SessionError("not-found") を throw', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => false,
      data: () => undefined,
      ref: { __docRef: true },
    });
    await expect(applyPayment('missing', 'p1', 800)).rejects.toMatchObject({
      code: 'not-found',
    });
    expect(mockTransactionUpdate).not.toHaveBeenCalled();
  });

  it('invalid-state: gameState 未定義だと SessionError("invalid-state") を throw', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({}),
      ref: { __docRef: true },
    });
    await expect(applyPayment('s', 'p1', 800)).rejects.toMatchObject({
      code: 'invalid-state',
    });
  });

  it('aborted: Firestore aborted を SessionError("conflict") に変換', async () => {
    mockRunTransaction.mockImplementationOnce(async () => {
      const err = new Error('aborted') as Error & { code?: string };
      err.code = 'aborted';
      throw err;
    });
    await expect(applyPayment('s', 'p1', 800)).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('aborted 以外のエラーは素通し', async () => {
    mockRunTransaction.mockImplementationOnce(async () => {
      throw new Error('network down');
    });
    await expect(applyPayment('s', 'p1', 800)).rejects.toThrow('network down');
  });
});

describe('sessionMutations - updatePlayer wrapper (rename sync)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunTransaction.mockImplementation(async (_db, cb) => cb(mockTransaction));
  });

  it('名前変更時: participants / admins / createdBy の旧名を新名に置換する', async () => {
    const state = baseState({
      players: [makePlayer('p1', { name: 'Alice' }), makePlayer('p2', { name: 'Bob' })],
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        gameState: state,
        participants: ['Alice', 'Bob'],
        admins: ['Alice'],
        createdBy: 'Alice',
      }),
      ref: { __docRef: true },
    });

    await updatePlayer('s', 'p1', { name: 'Alice2' });

    const updateArgs = mockTransactionUpdate.mock.calls[0][1];
    expect(updateArgs.participants).toEqual(['Alice2', 'Bob']);
    expect(updateArgs.admins).toEqual(['Alice2']);
    expect(updateArgs.createdBy).toBe('Alice2');
    expect(updateArgs.gameState.players[0].name).toBe('Alice2');
  });

  it('名前未変更時: session レベルのフィールドを書き換えない', async () => {
    const state = baseState({ players: [makePlayer('p1', { name: 'Alice' })] });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        gameState: state,
        participants: ['Alice'],
        admins: ['Alice'],
        createdBy: 'Alice',
      }),
      ref: { __docRef: true },
    });

    await updatePlayer('s', 'p1', { gender: 'F' });

    const updateArgs = mockTransactionUpdate.mock.calls[0][1];
    expect(updateArgs.participants).toBeUndefined();
    expect(updateArgs.admins).toBeUndefined();
    expect(updateArgs.createdBy).toBeUndefined();
    expect(updateArgs.gameState.players[0].gender).toBe('F');
  });

  it('名前変更でも旧名が含まれないフィールドは書き換えない', async () => {
    const state = baseState({
      players: [makePlayer('p1', { name: 'Alice' }), makePlayer('p2', { name: 'Bob' })],
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        gameState: state,
        participants: ['Bob'],
        admins: ['Bob'],
        createdBy: 'Bob',
      }),
      ref: { __docRef: true },
    });

    await updatePlayer('s', 'p1', { name: 'Alice2' });

    const updateArgs = mockTransactionUpdate.mock.calls[0][1];
    expect(updateArgs.participants).toBeUndefined();
    expect(updateArgs.admins).toBeUndefined();
    expect(updateArgs.createdBy).toBeUndefined();
  });
});

describe('sessionMutations - addPlayers wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunTransaction.mockImplementation(async (_db, cb) => cb(mockTransaction));
  });

  it('added / skipped を呼び出し側に返す', async () => {
    const state = baseState({ players: [makePlayer('p1', { name: 'Alice' })] });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    const result = await addPlayers('s', [{ name: 'Alice' }, { name: 'Bob' }]);
    expect(result.added).toBe(1);
    expect(result.skipped).toEqual(['Alice']);
    expect(result.state.players).toHaveLength(2);
    expect(result.state.players[1].name).toBe('Bob');
  });
});

describe('sessionMutations - finishMatchAndContinue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunTransaction.mockImplementation(async (_db, cb) => cb(mockTransaction));
  });

  it('matchStartedAt <= 0 で invalid-arg を throw（read 前にガード）', async () => {
    await expect(
      finishMatchAndContinue('s', 1, 0, {
        matchId: 'm1',
        useStayDurationPriority: false,
        prioritizeDiversity: false,
      }),
    ).rejects.toMatchObject({ code: 'invalid-arg' });
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it('既に終了済み（startedAt が一致しない）なら already_finished を返し update しない', async () => {
    const state = baseState({
      players: [makePlayer('p1', { name: 'Alice' })],
      courts: [
        makeCourt(1, {
          teamA: ['p1', 'p2'],
          teamB: ['p3', 'p4'],
          isPlaying: true,
          startedAt: 9999, // 呼び出し側が知っていたのは 1000
        }),
      ],
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    const result = await finishMatchAndContinue('s', 1, 1000, {
      matchId: 'm1',
      useStayDurationPriority: false,
      prioritizeDiversity: false,
    });
    expect(result.result).toBe('already_finished');
    expect(result.writtenState).toBeUndefined();
    expect(mockTransactionUpdate).not.toHaveBeenCalled();
  });

  it('isPlaying が false なら already_finished', async () => {
    const state = baseState({
      players: [makePlayer('p1', { name: 'Alice' })],
      courts: [
        makeCourt(1, {
          teamA: ['p1', 'p2'],
          teamB: ['p3', 'p4'],
          isPlaying: false,
          startedAt: 1000,
        }),
      ],
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    const result = await finishMatchAndContinue('s', 1, 1000, {
      matchId: 'm1',
      useStayDurationPriority: false,
      prioritizeDiversity: false,
    });
    expect(result.result).toBe('already_finished');
    expect(mockTransactionUpdate).not.toHaveBeenCalled();
  });

  it('aborted を SessionError("conflict") に変換', async () => {
    mockRunTransaction.mockImplementationOnce(async () => {
      const err = new Error('aborted') as Error & { code?: string };
      err.code = 'aborted';
      throw err;
    });
    await expect(
      finishMatchAndContinue('s', 1, 1000, {
        matchId: 'm1',
        useStayDurationPriority: false,
        prioritizeDiversity: false,
      }),
    ).rejects.toBeInstanceOf(SessionError);
  });
});

// =============================================================================
// Phase 6: overwriteGameState（mutateGameState を使わず remote.gameState 未初期化でも動く）
// =============================================================================

describe('sessionMutations - overwriteGameState (B1 fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunTransaction.mockImplementation(async (_db, cb) => cb(mockTransaction));
  });

  it('remote.gameState が未定義でも書き込み成功する（新規セッション初期化）', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      // createSession 直後の doc: gameState フィールド無し
      data: () => ({ id: 'sess', config: {}, createdBy: 'Alice' }),
      ref: { __docRef: true },
    });

    const initial = baseState({
      players: [makePlayer('p1', { name: 'Alice' })],
      courts: [makeCourt(1)],
    });

    const result = await overwriteGameState('sess', initial);

    expect(result).toBe(initial);
    expect(mockTransactionUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockTransactionUpdate.mock.calls[0][1];
    expect(updateArgs.gameState.players).toHaveLength(1);
    expect(updateArgs.registeredPlayers).toEqual(['Alice']);
  });

  it('snap.exists()=false なら not-found を throw（書き込み無し）', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => false,
      data: () => undefined,
      ref: { __docRef: true },
    });
    await expect(overwriteGameState('missing', baseState())).rejects.toMatchObject({
      code: 'not-found',
    });
    expect(mockTransactionUpdate).not.toHaveBeenCalled();
  });

  it('aborted を SessionError("conflict") に変換', async () => {
    mockRunTransaction.mockImplementationOnce(async () => {
      const err = new Error('aborted') as Error & { code?: string };
      err.code = 'aborted';
      throw err;
    });
    await expect(overwriteGameState('s', baseState())).rejects.toMatchObject({
      code: 'conflict',
    });
  });
});

// =============================================================================
// Phase 6: updateMatch（B2/B4 修正で追加）
// =============================================================================

describe('sessionMutations - updateMatch (B2/B4 fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunTransaction.mockImplementation(async (_db, cb) => cb(mockTransaction));
  });

  it('match の partial update（teamA/teamB swap）', async () => {
    const state = baseState({
      matchHistory: [makeMatch('m1', { teamA: ['a', 'b'], teamB: ['c', 'd'] })],
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    await updateMatch('s', 'm1', { teamA: ['c', 'd'], teamB: ['a', 'b'] });

    const updateArgs = mockTransactionUpdate.mock.calls[0][1];
    expect(updateArgs.gameState.matchHistory[0]).toMatchObject({
      teamA: ['c', 'd'],
      teamB: ['a', 'b'],
    });
  });

  it('id を上書きしない（updates.id を渡しても match.id は維持）', async () => {
    const state = baseState({
      matchHistory: [makeMatch('m1', { scoreA: 0, scoreB: 0 })],
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    await updateMatch('s', 'm1', { scoreA: 21, scoreB: 19, winner: 'A' } as Partial<Match>);

    const updateArgs = mockTransactionUpdate.mock.calls[0][1];
    expect(updateArgs.gameState.matchHistory[0]).toMatchObject({
      id: 'm1',
      scoreA: 21,
      scoreB: 19,
      winner: 'A',
    });
  });
});

// =============================================================================
// Phase 6: autoAssignAndFulfill（H4 fix）
// =============================================================================

describe('sessionMutations - autoAssignAndFulfill (H4 fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunTransaction.mockImplementation(async (_db, cb) => cb(mockTransaction));
  });

  it('予約消化と複数コート更新を 1 transaction でまとめる', async () => {
    const state = baseState({
      courts: [makeCourt(1), makeCourt(2)],
      reservations: [
        { id: 'r1', orderNumber: 1, playerIds: ['p1'], status: 'pending', createdAt: 0, fulfilledAt: 0 },
      ],
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    await autoAssignAndFulfill(
      's',
      [
        { courtId: 1, teamA: ['a', 'b'], teamB: ['c', 'd'], isPlaying: true, startedAt: 5000 },
        { courtId: 2, teamA: ['e', 'f'], teamB: ['g', 'h'], isPlaying: false, startedAt: 0 },
      ],
      ['r1'],
      5000,
    );

    expect(mockTransactionUpdate).toHaveBeenCalledTimes(1);
    const next = mockTransactionUpdate.mock.calls[0][1].gameState;
    expect(next.reservations[0].status).toBe('fulfilled');
    expect(next.reservations[0].fulfilledAt).toBe(5000);
    expect(next.courts[0]).toMatchObject({ teamA: ['a', 'b'], isPlaying: true, startedAt: 5000 });
    expect(next.courts[1]).toMatchObject({ teamA: ['e', 'f'], isPlaying: false });
  });
});

// =============================================================================
// Phase 6: resizeCourtsWithConfig（H6 fix）
// =============================================================================

// =============================================================================
// Phase 7: swapPlayer composite (CON2 fix)
// =============================================================================

describe('sessionMutations - swapPlayer (CON2 fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunTransaction.mockImplementation(async (_db, cb) => cb(mockTransaction));
  });

  it('コート上のプレイヤーを入れ替えながら、休憩中だったプレイヤーを 1 transaction で待機状態に戻す', async () => {
    const state = baseState({
      players: [
        makePlayer('p1', { isResting: false }),
        makePlayer('rest', { isResting: true }),
      ],
      courts: [makeCourt(1, { teamA: ['p1', ''], teamB: ['', ''] })],
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    await swapPlayer('s', 1, 0, 'rest');

    expect(mockTransactionUpdate).toHaveBeenCalledTimes(1);
    const next = mockTransactionUpdate.mock.calls[0][1].gameState;
    expect(next.courts[0].teamA[0]).toBe('rest');
    // 休憩中プレイヤーは isResting=false に切り替わる（試合後の復帰は finish の統一ルール）
    expect(next.players.find((p: { id: string }) => p.id === 'rest').isResting).toBe(false);
  });

  it('既に待機中のプレイヤーを swap しても isResting を触らない', async () => {
    const state = baseState({
      players: [
        makePlayer('p1', { isResting: false }),
        makePlayer('p2', { isResting: false }),
      ],
      courts: [makeCourt(1, { teamA: ['p1', ''], teamB: ['', ''] })],
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    await swapPlayer('s', 1, 1, 'p2');

    const next = mockTransactionUpdate.mock.calls[0][1].gameState;
    expect(next.courts[0].teamA).toEqual(['p1', 'p2']);
    expect(next.players.find((p: { id: string }) => p.id === 'p2').isResting).toBe(false);
  });

  it('休憩中プレイヤーを入れると court.restingPlayerIds に積まれる（試合後に休憩へ戻す）', async () => {
    const state = baseState({
      players: [
        makePlayer('p1', { isResting: false }),
        makePlayer('rest', { isResting: true }),
      ],
      courts: [makeCourt(1, { teamA: ['p1', ''], teamB: ['', ''] })],
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    await swapPlayer('s', 1, 0, 'rest');

    const next = mockTransactionUpdate.mock.calls[0][1].gameState;
    expect(next.courts[0].restingPlayerIds).toEqual(['rest']);
  });

  it('未成立予約を持つ休憩中プレイヤーは restingPlayerIds に積まない（予約ルールに委ねる）', async () => {
    const state = baseState({
      players: [
        makePlayer('p1', { isResting: false }),
        makePlayer('rsv', { isResting: true }),
      ],
      courts: [makeCourt(1, { teamA: ['p1', ''], teamB: ['', ''] })],
      reservations: [
        { id: 'r1', orderNumber: 1, playerIds: ['rsv'], status: 'pending', createdAt: 0, fulfilledAt: 0 },
      ],
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    await swapPlayer('s', 1, 0, 'rsv');

    const next = mockTransactionUpdate.mock.calls[0][1].gameState;
    expect(next.courts[0].restingPlayerIds ?? []).toEqual([]);
    expect(next.players.find((p: { id: string }) => p.id === 'rsv').isResting).toBe(false);
  });

  it('restingPlayerIds のメンバーをコートから外すと、その場で休憩へ戻る', async () => {
    const state = baseState({
      players: [
        makePlayer('rest', { isResting: false }),
        makePlayer('w1', { isResting: false }),
      ],
      courts: [
        makeCourt(1, { teamA: ['rest', ''], teamB: ['', ''], restingPlayerIds: ['rest'] }),
      ],
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    await swapPlayer('s', 1, 0, 'w1');

    const next = mockTransactionUpdate.mock.calls[0][1].gameState;
    expect(next.courts[0].teamA).toEqual(['w1', '']);
    expect(next.courts[0].restingPlayerIds).toEqual([]);
    expect(next.players.find((p: { id: string }) => p.id === 'rest').isResting).toBe(true);
  });
});

describe('sessionMutations - swapPositions (CON5 fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunTransaction.mockImplementation(async (_db, cb) => cb(mockTransaction));
  });

  it('同一コート内の 2 ポジションを 1 transaction で入れ替える', async () => {
    const state = baseState({
      players: [
        makePlayer('A', { isResting: false }),
        makePlayer('B', { isResting: false }),
        makePlayer('C', { isResting: false }),
        makePlayer('D', { isResting: false }),
      ],
      courts: [makeCourt(1, { teamA: ['A', 'B'], teamB: ['C', 'D'] })],
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    await swapPositions('s', { courtId: 1, position: 0 }, { courtId: 1, position: 3 });

    expect(mockTransactionUpdate).toHaveBeenCalledTimes(1);
    const next = mockTransactionUpdate.mock.calls[0][1].gameState;
    // A (pos 0 = teamA[0]) と D (pos 3 = teamB[1]) が入れ替わる
    expect(next.courts[0].teamA).toEqual(['D', 'B']);
    expect(next.courts[0].teamB).toEqual(['C', 'A']);
  });

  it('異コート間の 2 ポジションを 1 transaction で入れ替える（同じプレイヤーが両コートに乗る不整合を防ぐ）', async () => {
    const state = baseState({
      players: [
        makePlayer('A', { isResting: false }),
        makePlayer('B', { isResting: false }),
        makePlayer('C', { isResting: false }),
        makePlayer('D', { isResting: false }),
        makePlayer('E', { isResting: false }),
        makePlayer('F', { isResting: false }),
        makePlayer('G', { isResting: false }),
        makePlayer('H', { isResting: false }),
      ],
      courts: [
        makeCourt(1, { teamA: ['A', 'B'], teamB: ['C', 'D'] }),
        makeCourt(2, { teamA: ['E', 'F'], teamB: ['G', 'H'] }),
      ],
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    // court 1 pos 0 (A) ⇔ court 2 pos 2 (G)
    await swapPositions('s', { courtId: 1, position: 0 }, { courtId: 2, position: 2 });

    // 1 transaction で両コートが同時に更新される
    expect(mockTransactionUpdate).toHaveBeenCalledTimes(1);
    const next = mockTransactionUpdate.mock.calls[0][1].gameState;
    expect(next.courts[0].teamA).toEqual(['G', 'B']);
    expect(next.courts[0].teamB).toEqual(['C', 'D']);
    expect(next.courts[1].teamA).toEqual(['E', 'F']);
    expect(next.courts[1].teamB).toEqual(['A', 'H']);
  });

  it('存在しない court ID の場合は state を変更しない', async () => {
    const state = baseState({
      courts: [makeCourt(1, { teamA: ['A', 'B'], teamB: ['C', 'D'] })],
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    await swapPositions('s', { courtId: 1, position: 0 }, { courtId: 99, position: 0 });

    const next = mockTransactionUpdate.mock.calls[0][1].gameState;
    expect(next.courts[0].teamA).toEqual(['A', 'B']);
    expect(next.courts[0].teamB).toEqual(['C', 'D']);
  });

  it('異コート間スワップで restingPlayerIds フラグを移動先コートへ引き継ぐ', async () => {
    const state = baseState({
      players: [
        makePlayer('A'), makePlayer('B'), makePlayer('C'), makePlayer('D'),
        makePlayer('E'), makePlayer('F'), makePlayer('G'), makePlayer('H'),
      ],
      courts: [
        makeCourt(1, { teamA: ['A', 'B'], teamB: ['C', 'D'], restingPlayerIds: ['A'] }),
        makeCourt(2, { teamA: ['E', 'F'], teamB: ['G', 'H'] }),
      ],
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state }),
      ref: { __docRef: true },
    });

    // court 1 pos 0 (A) ⇔ court 2 pos 2 (G)
    await swapPositions('s', { courtId: 1, position: 0 }, { courtId: 2, position: 2 });

    const next = mockTransactionUpdate.mock.calls[0][1].gameState;
    expect(next.courts[0].restingPlayerIds).toEqual([]);
    expect(next.courts[1].restingPlayerIds).toEqual(['A']);
  });
});

describe('sessionMutations - resizeCourtsWithConfig (H6 fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunTransaction.mockImplementation(async (_db, cb) => cb(mockTransaction));
  });

  it('gameState.courts と config.courtCount を 1 transaction で更新', async () => {
    const state = baseState({
      courts: [makeCourt(1)],
    });
    mockTransactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ gameState: state, config: { courtCount: 1 } }),
      ref: { __docRef: true },
    });

    await resizeCourtsWithConfig('s', 3);

    expect(mockTransactionUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockTransactionUpdate.mock.calls[0][1];
    expect(updateArgs['config.courtCount']).toBe(3);
    expect(updateArgs.gameState.courts).toHaveLength(3);
  });
});
