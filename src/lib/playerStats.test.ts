import { describe, it, expect } from 'vitest';
import type { Player } from '../types/player';
import { computeExpectedGames, computeGamesStats, computeStayStats, formatDiff, formatExpected, formatMedian, formatStayMinutes } from './playerStats';

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

describe('computeExpectedGames', () => {
  const now = 10_000 * MIN;
  const start = now - 120 * MIN;

  it('回数平均モードは全員 合計/人数', () => {
    const ps = [mk('a', 8, true), mk('b', 4, false), mk('c', 3, true)];
    const stay = computeStayStats(ps, start, now);
    const r = computeExpectedGames(ps, 'count', stay.byId);
    expect(r.get('a')).toEqual({ expected: 5, diff: 3 });
    expect(r.get('b')).toEqual({ expected: 5, diff: -1 });
    expect(r.get('c')?.expected).toBe(5);
  });

  it('人数0は空', () => {
    expect(computeExpectedGames([], 'count', new Map()).size).toBe(0);
  });

  it('滞在モードは完了者のみで滞在按分、未完了は null', () => {
    // a: 120分, b: 60分 (開始から60分遅れて完了), c: 未完了
    const ps = [mk('a', 6, true, start), mk('b', 2, true, now - 60 * MIN), mk('c', 9, false)];
    const stay = computeStayStats(ps, start, now);
    const r = computeExpectedGames(ps, 'stay', stay.byId);
    // T' = 8, 滞在 120:60 → a=5.333.., b=2.666..
    expect(r.get('a')?.expected).toBeCloseTo(16 / 3);
    expect(r.get('a')?.diff).toBeCloseTo(6 - 16 / 3);
    expect(r.get('b')?.expected).toBeCloseTo(8 / 3);
    expect(r.get('c')).toEqual({ expected: null, diff: null });
  });

  it('滞在合計が0なら全員 null', () => {
    const ps = [mk('a', 3, true, now), mk('b', 2, true, now)];
    const stay = computeStayStats(ps, start, now);
    const r = computeExpectedGames(ps, 'stay', stay.byId);
    expect(r.get('a')?.expected).toBeNull();
    expect(r.get('b')?.diff).toBeNull();
  });
});

describe('formatExpected / formatDiff', () => {
  it('小数1桁', () => expect(formatExpected(7.25)).toBe('7.3'));
  it('符号付き', () => {
    expect(formatDiff(0.8)).toBe('+0.8');
    expect(formatDiff(-1.04)).toBe('−1.0');
    expect(formatDiff(0.04)).toBe('±0');
    expect(formatDiff(-0.04)).toBe('±0');
  });
});
