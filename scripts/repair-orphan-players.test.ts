import { describe, it, expect } from 'vitest';
import {
  collectReferencedIds,
  findOrphanIds,
  describeOrphan,
  buildRestoredPlayer,
  remapPlayerId,
  findCandidateNames,
  parseAssignments,
} from './repair-orphan-players';
import type { GameState } from '../src/services/sessionService';

const player = (id: string, name: string, extra: Partial<{ gamesPlayed: number; lastPlayedAt: number }> = {}) => ({
  id,
  name,
  isResting: false,
  gamesPlayed: extra.gamesPlayed ?? 0,
  lastPlayedAt: extra.lastPlayedAt ?? 0,
  activatedAt: 0,
});

const match = (
  id: string,
  teamA: [string, string],
  teamB: [string, string],
  finishedAt: number,
) => ({ id, courtId: 1, teamA, teamB, scoreA: 15, scoreB: 10, startedAt: finishedAt - 600, finishedAt });

const emptyCourt = {
  id: 1,
  teamA: ['', ''] as [string, string],
  teamB: ['', ''] as [string, string],
  scoreA: 0,
  scoreB: 0,
  isPlaying: false,
  startedAt: 0,
  finishedAt: 0,
};

/** 削除された p9 の ID が履歴に残ったままの状態 */
const brokenState = (): GameState => ({
  players: [player('p1', '田中'), player('p2', '佐藤'), player('p3', '山田')],
  courts: [emptyCourt],
  matchHistory: [
    match('m1', ['p1', 'p9'], ['p2', 'p3'], 1000),
    match('m2', ['p9', 'p2'], ['p1', 'p3'], 2000),
    match('m3', ['p1', 'p2'], ['p3', ''], 3000),
  ],
  reservations: [],
});

describe('collectReferencedIds', () => {
  it('履歴・コート・予約から参照 ID を集め、空文字は含めない', () => {
    const state: GameState = {
      ...brokenState(),
      courts: [{ ...emptyCourt, teamA: ['p1', ''], restingPlayerIds: ['p7'] }],
      reservations: [
        { id: 'r1', orderNumber: 1, playerIds: ['p8'], status: 'pending', createdAt: 0, fulfilledAt: 0 },
      ],
    };
    const ids = collectReferencedIds(state);
    expect([...ids].sort()).toEqual(['p1', 'p2', 'p3', 'p7', 'p8', 'p9']);
    expect(ids.has('')).toBe(false);
  });
});

describe('findOrphanIds', () => {
  it('players に居ない参照 ID を返す', () => {
    expect(findOrphanIds(brokenState())).toEqual(['p9']);
  });

  it('欠損が無ければ空配列', () => {
    const state = brokenState();
    state.players.push(player('p9', '消えた人'));
    expect(findOrphanIds(state)).toEqual([]);
  });
});

describe('describeOrphan', () => {
  it('出場試合と同席者を新しい順で返す', () => {
    const d = describeOrphan(brokenState(), 'p9');
    expect(d.matches).toHaveLength(2);
    expect(d.matches[0].at).toBe(2000);
    expect(d.matches[0].teammates).toEqual(['佐藤']);
    expect(d.matches[0].opponents).toEqual(['田中', '山田']);
    expect(d.knownCompanions.sort()).toEqual(['佐藤', '山田', '田中']);
  });

  it('コート上・予約中かを判定する', () => {
    const state = brokenState();
    state.courts = [{ ...emptyCourt, teamB: ['p9', ''] }];
    state.reservations = [
      { id: 'r1', orderNumber: 1, playerIds: ['p9'], status: 'pending', createdAt: 0, fulfilledAt: 0 },
    ];
    const d = describeOrphan(state, 'p9');
    expect(d.onCourt).toBe(true);
    expect(d.inReservation).toBe(true);
  });
});

describe('buildRestoredPlayer', () => {
  it('履歴から gamesPlayed / lastPlayedAt を再計算する', () => {
    const p = buildRestoredPlayer(brokenState(), 'p9', '消えた人');
    expect(p.id).toBe('p9');
    expect(p.name).toBe('消えた人');
    expect(p.gamesPlayed).toBe(2);
    expect(p.lastPlayedAt).toBe(2000);
    expect(p.isResting).toBe(true);
    expect(p).not.toHaveProperty('rating');
  });

  it('コートに乗っていれば isResting: false で復元する', () => {
    const state = brokenState();
    state.courts = [{ ...emptyCourt, teamA: ['p9', 'p1'], isPlaying: true }];
    expect(buildRestoredPlayer(state, 'p9', '消えた人').isResting).toBe(false);
  });

  it('rating / gender を指定できる', () => {
    const p = buildRestoredPlayer(brokenState(), 'p9', '消えた人', { rating: 7, gender: 'F' });
    expect(p.rating).toBe(7);
    expect(p.gender).toBe('F');
  });
});

describe('remapPlayerId', () => {
  it('履歴の旧IDを新IDへ差し替え、gamesPlayed を再計算する', () => {
    const state = brokenState();
    state.players.push(player('pNew', '消えた人'));

    const next = remapPlayerId(state, 'p9', 'pNew');

    expect(findOrphanIds(next)).toEqual([]);
    expect(next.matchHistory[0].teamA).toEqual(['p1', 'pNew']);
    expect(next.matchHistory[1].teamA).toEqual(['pNew', 'p2']);
    const restored = next.players.find((p) => p.id === 'pNew');
    expect(restored?.gamesPlayed).toBe(2);
    expect(restored?.lastPlayedAt).toBe(2000);
  });

  it('コート・予約の参照も差し替え、同じ予約内の重複は潰す', () => {
    const state = brokenState();
    state.players.push(player('pNew', '消えた人'));
    state.courts = [{ ...emptyCourt, teamA: ['p9', 'p1'], restingPlayerIds: ['p9'] }];
    state.reservations = [
      { id: 'r1', orderNumber: 1, playerIds: ['p9', 'pNew', 'p1'], status: 'pending', createdAt: 0, fulfilledAt: 0 },
    ];

    const next = remapPlayerId(state, 'p9', 'pNew');

    expect(next.courts[0].teamA).toEqual(['pNew', 'p1']);
    expect(next.courts[0].restingPlayerIds).toEqual(['pNew']);
    expect(next.reservations[0].playerIds).toEqual(['pNew', 'p1']);
  });

  it('無関係なプレイヤーの gamesPlayed は変えない', () => {
    const state = brokenState();
    state.players = [player('p1', '田中', { gamesPlayed: 3 }), player('pNew', '消えた人')];
    const next = remapPlayerId(state, 'p9', 'pNew');
    expect(next.players.find((p) => p.id === 'p1')?.gamesPlayed).toBe(3);
  });
});

describe('findCandidateNames', () => {
  it('players に居ない名前だけを重複なく集める', () => {
    const state = brokenState();
    const session = {
      participants: ['田中', 'ゆーた'],
      registeredPlayers: ['田中', '佐藤', '山田'],
      lastSeen: { ゆーた: 100, 佐藤: 200 },
      information: { readBy: ['あら'] },
    };
    expect(findCandidateNames(session, state)).toEqual(['ゆーた', 'あら']);
  });

  it('候補が無ければ空配列', () => {
    expect(findCandidateNames({ participants: ['田中'] }, brokenState())).toEqual([]);
  });
});

describe('parseAssignments', () => {
  it('key=value を Map にする', () => {
    const args = ['ABC123', '--restore', 'p9=消えた人', '--restore', 'p8=別の人', '--apply'];
    expect([...parseAssignments(args, '--restore')]).toEqual([
      ['p9', '消えた人'],
      ['p8', '別の人'],
    ]);
  });

  it('値に = が含まれても最初の = で分割する', () => {
    expect(parseAssignments(['--remap', 'p9=p1=x'], '--remap').get('p9')).toBe('p1=x');
  });

  it('形式が不正なら例外', () => {
    expect(() => parseAssignments(['--restore', 'p9'], '--restore')).toThrow();
    expect(() => parseAssignments(['--restore', '=名前'], '--restore')).toThrow();
    expect(() => parseAssignments(['--restore'], '--restore')).toThrow();
  });

  it('該当フラグが無ければ空 Map', () => {
    expect(parseAssignments(['ABC123'], '--restore').size).toBe(0);
  });
});
