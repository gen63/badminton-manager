/**
 * 目的8 `recency`（連続出場を少し嫌う）の単体テスト。
 * `docs/plans/2026-09-08-recency-penalty.md`
 *
 * 目的1〜7 の単体テストは `assignRound.test.ts` にある（このファイルは
 * recency の追加とあわせて新設した）。
 */
import { describe, it, expect } from 'vitest';
import { computeRecency, type CourtPlacement } from './objective';

function court(
  courtId: number,
  teamA: [string, string],
  teamB: [string, string]
): CourtPlacement {
  return { courtId, teamA, teamB };
}

describe('computeRecency', () => {
  const courts = [court(1, ['p0', 'p1'], ['p2', 'p3'])];

  it('全員が直前の試合に出ていた（gap 0）なら 1', () => {
    const gaps = new Map(['p0', 'p1', 'p2', 'p3'].map(id => [id, 0]));
    expect(computeRecency(courts, gaps, 3)).toBe(1);
  });

  it('1巡（コート数ぶん）休んでいれば 0', () => {
    const gaps = new Map(['p0', 'p1', 'p2', 'p3'].map(id => [id, 3]));
    expect(computeRecency(courts, gaps, 3)).toBe(0);
    // 1巡を超えていても負にはならない（max(0, ...)）
    const older = new Map(['p0', 'p1', 'p2', 'p3'].map(id => [id, 10]));
    expect(computeRecency(courts, older, 3)).toBe(0);
  });

  it('未出場は 0 として扱う（Map に無い / Infinity のどちらでも）', () => {
    expect(computeRecency(courts, new Map(), 3)).toBe(0);
    const inf = new Map(['p0', 'p1', 'p2', 'p3'].map(id => [id, Infinity]));
    expect(computeRecency(courts, inf, 3)).toBe(0);
  });

  it('gap に比例して線形に減る（gap 1 / span 3 なら 2/3）', () => {
    const gaps = new Map(['p0', 'p1', 'p2', 'p3'].map(id => [id, 1]));
    expect(computeRecency(courts, gaps, 3)).toBeCloseTo(2 / 3, 10);
  });

  it('配置された全員の平均を取る（出場者数で割る。未出場も分母に入る）', () => {
    // p0 のみ直前出場（1.0）、残り3人は未出場（0）→ 平均 0.25
    const gaps = new Map([['p0', 0]]);
    expect(computeRecency(courts, gaps, 3)).toBeCloseTo(0.25, 10);
  });

  it('コートをまたいでも全出場者の平均（コートごとの平均の平均ではない）', () => {
    const twoCourts = [
      court(1, ['p0', 'p1'], ['p2', 'p3']),
      court(2, ['p4', 'p5'], ['p6', 'p7']),
    ];
    // コート1の4人だけが直前出場 → 8人中4人が 1.0 → 0.5
    const gaps = new Map(['p0', 'p1', 'p2', 'p3'].map(id => [id, 0]));
    expect(computeRecency(twoCourts, gaps, 3)).toBeCloseTo(0.5, 10);
  });

  it('span は最低1として扱う（0 や負でも 0除算しない）', () => {
    const gaps = new Map([
      ['p0', 0], ['p1', 0], ['p2', 1], ['p3', 1],
    ]);
    // span=1 相当 → gap0 は 1.0、gap1 は 0 → 平均 0.5
    expect(computeRecency(courts, gaps, 0)).toBeCloseTo(0.5, 10);
    expect(computeRecency(courts, gaps, 1)).toBeCloseTo(0.5, 10);
  });

  it('コートが無ければ 0（練習開始直後・0除算しない）', () => {
    expect(computeRecency([], new Map([['p0', 0]]), 3)).toBe(0);
  });

  it('常に 0〜1 に収まる', () => {
    const gaps = new Map([
      ['p0', -5], // 想定外の負値でもクランプされる
      ['p1', 0],
      ['p2', 100],
      ['p3', 2],
    ]);
    const value = computeRecency(courts, gaps, 3);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });
});
