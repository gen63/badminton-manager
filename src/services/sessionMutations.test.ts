import { describe, it, expect } from 'vitest';
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
  computeAddMatch,
  computeRemoveMatch,
  computeUpdateMatchScore,
  computeAddReservation,
  computeRemoveReservation,
  computeFulfillReservation,
  computeClearReservations,
  computeSetSetting,
} from './sessionMutations';
import type { GameState } from './sessionService';
import type { Player } from '../types/player';
import type { Court } from '../types/court';
import type { Match } from '../types/match';

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

    it('payment ON→OFF（再操作）は paymentTimestamp を更新しない', () => {
      const state = baseState({
        players: [makePlayer('a', {
          operationStatus: { payment: true, roster: false, checkin: false },
          paymentTimestamp: 1000,
        })],
      });
      const next = computeApplyPayment(state, 'a', 0, 9999);
      expect(next.players[0].operationStatus?.payment).toBe(false);
      expect(next.players[0].paymentTimestamp).toBe(1000);
      expect(next.players[0].paymentAmount).toBe(0);
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
          restingPlayerIds: ['r1'],
        }),
      ],
    });
    const next = computeClearCourt(state, 1);
    expect(next.courts[0]).toMatchObject({
      teamA: ['', ''],
      teamB: ['', ''],
      isPlaying: false,
      startedAt: 0,
      restingPlayerIds: [],
    });
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

  it('computeUpdateMatchScore: スコアと winner を更新', () => {
    const state = baseState({ matchHistory: [makeMatch('m1', { scoreA: 0, scoreB: 0 })] });
    const next = computeUpdateMatchScore(state, 'm1', 21, 19, 'A');
    expect(next.matchHistory[0]).toMatchObject({ scoreA: 21, scoreB: 19, winner: 'A' });
  });
});

describe('sessionMutations - reservations', () => {
  it('computeAddReservation: orderNumber は max+1', () => {
    const state = baseState({
      reservations: [
        { id: 'r1', orderNumber: 5, playerIds: ['p1'], status: 'pending', createdAt: 0, fulfilledAt: 0 },
      ],
    });
    const next = computeAddReservation(state, ['p2', 'p3'], 'admin', 'r2', 1000);
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
