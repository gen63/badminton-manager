import { describe, it, expect } from 'vitest';
import type { Player } from '../types/player';
import { computeExpectedGames, expectedDiffTone, computeGamesStats, computeStayStats, formatDiff, formatExpected, formatSinceLastGame, formatMedian, formatStayMinutes } from './playerStats';

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

  it('みなし開始時刻が期待試合数に反映され、overridden 目印が付く', () => {
    // a: 実際120分、b: 実際30分だが みなし 90分前開始 → 滞在 120:90
    const ps = [
      mk('a', 4, true, start),
      { ...mk('b', 3, true, now - 30 * MIN), stayStartOverrideAt: now - 90 * MIN },
    ];
    const stay = computeStayStats(ps, start, now);
    expect(stay.byId.get('b')).toEqual({ complete: true, minutes: 90, percent: 75, overridden: true });
    expect(stay.byId.get('a')?.overridden).toBeUndefined();
    const r = computeExpectedGames(ps, 'stay', stay.byId);
    // T' = 7, 滞在 120:90 → a=4, b=3
    expect(r.get('a')?.expected).toBeCloseTo(4);
    expect(r.get('b')?.expected).toBeCloseTo(3);
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

describe('computeStayStats の練習終了頭打ち', () => {
  const start = 1_000_000 * MIN;
  const end = start + 180 * MIN;

  it('終了前は従来どおり', () => {
    const now = start + 100 * MIN;
    const ps = [mk('a', 1, true, start)];
    expect(computeStayStats(ps, start, now, end).byId.get('a')?.minutes).toBeCloseTo(100);
  });

  it('終了後は終了時刻で頭打ち（最長滞在・割合・按分にも効く）', () => {
    const now = end + 60 * MIN;
    const ps = [mk('a', 6, true, start), mk('b', 2, true, start + 90 * MIN)];
    const st = computeStayStats(ps, start, now, end);
    expect(st.byId.get('a')?.minutes).toBeCloseTo(180);
    expect(st.byId.get('b')?.minutes).toBeCloseTo(90);
    expect(st.maxMinutes).toBeCloseTo(180);
    expect(st.byId.get('b')?.percent).toBe(50);
  });

  it('終了後に完了した人は 0（負にならない）', () => {
    const now = end + 60 * MIN;
    const ps = [mk('a', 1, true, end + 30 * MIN)];
    expect(computeStayStats(ps, start, now, end).byId.get('a')?.minutes).toBe(0);
  });

  it('未指定・0 は打ち止めなし', () => {
    const now = end + 60 * MIN;
    const ps = [mk('a', 1, true, start)];
    expect(computeStayStats(ps, start, now).byId.get('a')?.minutes).toBeCloseTo(240);
    expect(computeStayStats(ps, start, now, 0).byId.get('a')?.minutes).toBeCloseTo(240);
  });
});

describe('expectedDiffTone', () => {
  it('−1.5 より大きければ normal', () => {
    expect(expectedDiffTone(0)).toBe('normal');
    expect(expectedDiffTone(-1.4)).toBe('normal');
    expect(expectedDiffTone(2.5)).toBe('normal');
  });
  it('−1.5〜−2.4 は watch', () => {
    expect(expectedDiffTone(-1.5)).toBe('watch');
    expect(expectedDiffTone(-2.44)).toBe('watch');
  });
  it('−2.5 以下は alert（表示と同じ小数1桁丸め）', () => {
    expect(expectedDiffTone(-2.46)).toBe('alert');
    expect(expectedDiffTone(-4)).toBe('alert');
  });
});

describe('formatSinceLastGame', () => {
  const now = 1_000_000_000;
  const MIN = 60000;
  it('試合中・未試合', () => {
    expect(formatSinceLastGame(now - 5 * MIN, true, now)).toBe('試合中');
    expect(formatSinceLastGame(0, false, now)).toBe('未試合');
  });
  it('30分未満は分', () => {
    expect(formatSinceLastGame(now - 25 * MIN, false, now)).toBe('前回 25分前');
    expect(formatSinceLastGame(now - 29 * MIN - 59000, false, now)).toBe('前回 29分前');
    expect(formatSinceLastGame(now, false, now)).toBe('前回 0分前');
  });
  it('30分以上は 30分+ にまとめる', () => {
    expect(formatSinceLastGame(now - 30 * MIN, false, now)).toBe('前回 30分+前');
    expect(formatSinceLastGame(now - 65 * MIN, false, now)).toBe('前回 30分+前');
    expect(formatSinceLastGame(now - 120 * MIN, false, now)).toBe('前回 30分+前');
  });
});
