import { describe, it, expect } from 'vitest';
import { calculatePlayerStats } from './algorithm';
import type { Player } from '../types/player';
import type { Match } from '../types/match';

describe('calculatePlayerStats', () => {
  const createPlayer = (id: string, name: string): Player => ({
    id,
    name,
    gamesPlayed: 0,
    rating: 1500,
    isResting: false,
    lastPlayedAt: null,
    activatedAt: null,
  });

  const createMatch = (
    teamA: [string, string],
    teamB: [string, string],
    scoreA: number,
    scoreB: number
  ): Match => ({
    id: `match-${Date.now()}-${Math.random()}`,
    courtId: 1,
    teamA,
    teamB,
    scoreA,
    scoreB,
    winner: scoreA > scoreB ? 'A' : 'B',
    startedAt: Date.now(),
    finishedAt: Date.now(),
  });

  it('空の履歴では全員0試合', () => {
    const players = [
      createPlayer('p1', 'Player 1'),
      createPlayer('p2', 'Player 2'),
    ];

    const stats = calculatePlayerStats(players, []);

    expect(stats).toHaveLength(2);
    stats.forEach((s) => {
      expect(s.gamesPlayed).toBe(0);
      expect(s.wins).toBe(0);
      expect(s.losses).toBe(0);
      expect(s.points).toBe(0);
    });
  });

  it('1試合後の統計を正しく計算する', () => {
    const players = [
      createPlayer('p1', 'Player 1'),
      createPlayer('p2', 'Player 2'),
      createPlayer('p3', 'Player 3'),
      createPlayer('p4', 'Player 4'),
    ];

    const matches = [
      createMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15),
    ];

    const stats = calculatePlayerStats(players, matches);

    // チームA (p1, p2) が勝利
    const p1Stats = stats.find((s) => s.id === 'p1')!;
    const p2Stats = stats.find((s) => s.id === 'p2')!;
    expect(p1Stats.gamesPlayed).toBe(1);
    expect(p1Stats.wins).toBe(1);
    expect(p1Stats.losses).toBe(0);
    expect(p1Stats.points).toBe(21);

    expect(p2Stats.gamesPlayed).toBe(1);
    expect(p2Stats.wins).toBe(1);
    expect(p2Stats.losses).toBe(0);
    expect(p2Stats.points).toBe(21);

    // チームB (p3, p4) が敗北
    const p3Stats = stats.find((s) => s.id === 'p3')!;
    const p4Stats = stats.find((s) => s.id === 'p4')!;
    expect(p3Stats.gamesPlayed).toBe(1);
    expect(p3Stats.wins).toBe(0);
    expect(p3Stats.losses).toBe(1);
    expect(p3Stats.points).toBe(15);

    expect(p4Stats.gamesPlayed).toBe(1);
    expect(p4Stats.wins).toBe(0);
    expect(p4Stats.losses).toBe(1);
    expect(p4Stats.points).toBe(15);
  });

  it('複数試合の累計を正しく計算する', () => {
    const players = [
      createPlayer('p1', 'Player 1'),
      createPlayer('p2', 'Player 2'),
      createPlayer('p3', 'Player 3'),
      createPlayer('p4', 'Player 4'),
    ];

    const matches = [
      createMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15), // p1,p2勝利
      createMatch(['p1', 'p3'], ['p2', 'p4'], 15, 21), // p2,p4勝利
    ];

    const stats = calculatePlayerStats(players, matches);

    const p1Stats = stats.find((s) => s.id === 'p1')!;
    expect(p1Stats.gamesPlayed).toBe(2);
    expect(p1Stats.wins).toBe(1);
    expect(p1Stats.losses).toBe(1);
    expect(p1Stats.points).toBe(21 + 15);

    const p2Stats = stats.find((s) => s.id === 'p2')!;
    expect(p2Stats.gamesPlayed).toBe(2);
    expect(p2Stats.wins).toBe(2);
    expect(p2Stats.losses).toBe(0);
    expect(p2Stats.points).toBe(21 + 21);
  });

  it('試合に参加していないプレイヤーの統計は0', () => {
    const players = [
      createPlayer('p1', 'Player 1'),
      createPlayer('p2', 'Player 2'),
      createPlayer('p3', 'Player 3'),
      createPlayer('p4', 'Player 4'),
      createPlayer('p5', 'Player 5'), // 試合なし
    ];

    const matches = [
      createMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15),
    ];

    const stats = calculatePlayerStats(players, matches);

    const p5Stats = stats.find((s) => s.id === 'p5')!;
    expect(p5Stats.gamesPlayed).toBe(0);
    expect(p5Stats.wins).toBe(0);
    expect(p5Stats.losses).toBe(0);
    expect(p5Stats.points).toBe(0);
  });
});
