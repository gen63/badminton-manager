import { describe, it, expect } from 'vitest';
import type { Player } from '../types/player';
import { computeGamesStats, computeStayStats, formatMedian, formatStayMinutes } from './playerStats';

const MIN = 60000;
const mk = (id: string, gamesPlayed: number, done: boolean, opsCompletedAt?: number): Player =>
  ({
    id,
    name: id,
    gamesPlayed,
    operationStatus: { payment: done, roster: done, checkin: false },
    opsCompletedAt,
  }) as unknown as Player;

describe('computeGamesStats', () => {
  it('空は null', () => expect(computeGamesStats([])).toBeNull());
  it('奇数人数は中央の値', () => {
    expect(computeGamesStats([{ gamesPlayed: 5 }, { gamesPlayed: 1 }, { gamesPlayed: 3 }])).toEqual({ max: 5, min: 1, median: 3 });
  });
  it('偶数人数は中央2つの平均', () => {
    expect(computeGamesStats([{ gamesPlayed: 1 }, { gamesPlayed: 2 }, { gamesPlayed: 4 }, { gamesPlayed: 5 }])?.median).toBe(3);
    expect(computeGamesStats([{ gamesPlayed: 1 }, { gamesPlayed: 2 }])?.median).toBe(1.5);
  });
});

describe('formatMedian', () => {
  it('整数/小数', () => {
    expect(formatMedian(3)).toBe('3');
    expect(formatMedian(2.5)).toBe('2.5');
  });
});

describe('computeStayStats', () => {
  const now = 100 * MIN;
  it('滞在分と最長比の割合を出す', () => {
    const s = computeStayStats([mk('a', 1, true, 0), mk('b', 1, true, 50 * MIN)], 0, now);
    expect(s.maxMinutes).toBe(100);
    expect(s.byId.get('a')).toEqual({ complete: true, minutes: 100, percent: 100 });
    expect(s.byId.get('b')).toEqual({ complete: true, minutes: 50, percent: 50 });
  });
  it('練習開始より前の完了は練習開始から数える', () => {
    const s = computeStayStats([mk('a', 1, true, 10 * MIN)], 40 * MIN, now);
    expect(s.byId.get('a')?.minutes).toBe(60);
  });
  it('未完了は滞在0・complete=false', () => {
    const s = computeStayStats([mk('a', 1, true, 0), mk('b', 0, false)], 0, now);
    expect(s.byId.get('b')).toEqual({ complete: false, minutes: 0, percent: 0 });
  });
  it('最大滞在が0なら割合は null', () => {
    const s = computeStayStats([mk('a', 0, false)], 0, now);
    expect(s.maxMinutes).toBe(0);
    expect(s.byId.get('a')?.percent).toBeNull();
  });
});

describe('formatStayMinutes', () => {
  it('H:MM', () => {
    expect(formatStayMinutes(83)).toBe('1:23');
    expect(formatStayMinutes(5.9)).toBe('0:05');
  });
});
