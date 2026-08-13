import { describe, it, expect } from 'vitest';
import { withInProgressGames } from './effectiveGames';
import type { Player } from '../types/player';
import type { Court } from '../types/court';

/** テスト用プレイヤー生成 */
function makePlayer(id: string, overrides?: Partial<Player>): Player {
  return {
    id,
    name: `Player ${id}`,
    isResting: false,
    gamesPlayed: 0,
    lastPlayedAt: 0,
    activatedAt: Date.now() - 60000,
    ...overrides,
  };
}

/** テスト用コート生成 */
function makeCourt(id: number, overrides?: Partial<Court>): Court {
  return {
    id,
    teamA: ['', ''],
    teamB: ['', ''],
    scoreA: 0,
    scoreB: 0,
    isPlaying: false,
    startedAt: 0,
    finishedAt: 0,
    ...overrides,
  };
}

describe('withInProgressGames', () => {
  it('コート上のメンバーだけ gamesPlayed が +1 される', () => {
    const players = [
      makePlayer('p1', { gamesPlayed: 3 }),
      makePlayer('p2', { gamesPlayed: 5 }),
    ];
    const courts = [
      makeCourt(1, { teamA: ['p1', 'p2'], teamB: ['', ''], isPlaying: true }),
    ];
    const result = withInProgressGames(players, courts);
    expect(result.find(p => p.id === 'p1')?.gamesPlayed).toBe(4);
    expect(result.find(p => p.id === 'p2')?.gamesPlayed).toBe(6);
  });

  it('コート外のメンバーは gamesPlayed が変わらない', () => {
    const players = [
      makePlayer('p1', { gamesPlayed: 3 }),
      makePlayer('p2', { gamesPlayed: 5 }),
    ];
    const courts = [
      makeCourt(1, { teamA: ['p1', ''], teamB: ['', ''], isPlaying: true }),
    ];
    const result = withInProgressGames(players, courts);
    expect(result.find(p => p.id === 'p2')?.gamesPlayed).toBe(5);
  });

  it('空文字 ID は無視する', () => {
    const players = [makePlayer('p1', { gamesPlayed: 1 })];
    const courts = [makeCourt(1, { teamA: ['', ''], teamB: ['', ''] })];
    const result = withInProgressGames(players, courts);
    expect(result.find(p => p.id === 'p1')?.gamesPlayed).toBe(1);
  });

  it('休憩中でもコート上なら +1 される（isResting は判定に使わない）', () => {
    const players = [
      makePlayer('p1', { gamesPlayed: 2, isResting: true }),
    ];
    const courts = [
      makeCourt(1, { teamA: ['p1', ''], teamB: ['', ''] }),
    ];
    const result = withInProgressGames(players, courts);
    expect(result.find(p => p.id === 'p1')?.gamesPlayed).toBe(3);
  });

  it('isPlaying=false でも teamA/teamB に ID が入っていれば +1 される（assignedAt/isPlaying は見ない）', () => {
    const players = [makePlayer('p1', { gamesPlayed: 0 })];
    const courts = [
      makeCourt(1, { teamA: ['p1', ''], teamB: ['', ''], isPlaying: false, assignedAt: 0 }),
    ];
    const result = withInProgressGames(players, courts);
    expect(result.find(p => p.id === 'p1')?.gamesPlayed).toBe(1);
  });

  it('対象外のプレイヤーは同一オブジェクト参照のまま返す', () => {
    const p2 = makePlayer('p2', { gamesPlayed: 5 });
    const players = [makePlayer('p1', { gamesPlayed: 3 }), p2];
    const courts = [
      makeCourt(1, { teamA: ['p1', ''], teamB: ['', ''] }),
    ];
    const result = withInProgressGames(players, courts);
    expect(result.find(p => p.id === 'p2')).toBe(p2);
  });

  it('コート上に誰もいない場合、players 配列自体を同一参照で返す', () => {
    const players = [makePlayer('p1', { gamesPlayed: 3 })];
    const courts = [makeCourt(1)];
    const result = withInProgressGames(players, courts);
    expect(result).toBe(players);
  });
});
