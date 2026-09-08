/**
 * 目的8 `recency`（連続出場を少し嫌う）の単体テスト。
 * `docs/plans/2026-09-08-recency-penalty.md`
 *
 * 目的1〜7 の単体テストは `assignRound.test.ts` にある（このファイルは
 * recency の追加とあわせて新設した）。
 */
import { describe, it, expect } from 'vitest';
import { computeRecency, RECENCY_STREAK_SHAPE, type CourtPlacement } from './objective';

function court(
  courtId: number,
  teamA: [string, string],
  teamB: [string, string]
): CourtPlacement {
  return { courtId, teamA, teamB };
}

/** 4人全員に同じ連続出場数を与える */
function allStreak(streak: number): Map<string, number> {
  return new Map(['p0', 'p1', 'p2', 'p3'].map(id => [id, streak]));
}

describe('computeRecency（連続出場の長さで減点する）', () => {
  const courts = [court(1, ['p0', 'p1'], ['p2', 'p3'])];

  it('既定の形は「2連続まで0 / 3連続で0.5 / 4連続以上で1.0」', () => {
    expect(RECENCY_STREAK_SHAPE).toEqual({ allowance: 2, ramp: 2 });
    expect(computeRecency(courts, allStreak(1))).toBe(0);
    expect(computeRecency(courts, allStreak(2))).toBe(0); // 2連続は許容（害が無い）
    expect(computeRecency(courts, allStreak(3))).toBeCloseTo(0.5, 10);
    expect(computeRecency(courts, allStreak(4))).toBe(1);
    expect(computeRecency(courts, allStreak(7))).toBe(1); // 上限は 1.0（クランプ）
  });

  it('未出場・連続していない人は 0 として扱う（Map に無い / 0）', () => {
    expect(computeRecency(courts, new Map())).toBe(0);
    expect(computeRecency(courts, allStreak(0))).toBe(0);
  });

  it('配置された全員の平均を取る（出場者数で割る。連続していない人も分母に入る）', () => {
    // p0 だけ4連続（1.0）、残り3人は連続なし（0）→ 平均 0.25
    expect(computeRecency(courts, new Map([['p0', 4]]))).toBeCloseTo(0.25, 10);
    // p0 が3連続（0.5）だけなら 0.125
    expect(computeRecency(courts, new Map([['p0', 3]]))).toBeCloseTo(0.125, 10);
  });

  it('コートをまたいでも全出場者の平均（コートごとの平均の平均ではない）', () => {
    const twoCourts = [
      court(1, ['p0', 'p1'], ['p2', 'p3']),
      court(2, ['p4', 'p5'], ['p6', 'p7']),
    ];
    // コート1の4人だけが4連続 → 8人中4人が 1.0 → 0.5
    expect(computeRecency(twoCourts, allStreak(4))).toBeCloseTo(0.5, 10);
  });

  it('allowance / ramp を変えると効き始めと傾きが変わる', () => {
    // allowance=1 → 2連続から減点が始まる
    const shape1 = { allowance: 1, ramp: 2 };
    expect(computeRecency(courts, allStreak(1), shape1)).toBe(0);
    expect(computeRecency(courts, allStreak(2), shape1)).toBeCloseTo(0.5, 10);
    // ramp=1 → allowance を超えた次の1連続で一気に 1.0
    const shape2 = { allowance: 2, ramp: 1 };
    expect(computeRecency(courts, allStreak(3), shape2)).toBe(1);
    // ramp が 0 以下でも 0除算しない（最低1として扱う）
    expect(computeRecency(courts, allStreak(3), { allowance: 2, ramp: 0 })).toBe(1);
  });

  it('コートが無ければ 0（練習開始直後・0除算しない）', () => {
    expect(computeRecency([], allStreak(9))).toBe(0);
  });

  it('常に 0〜1 に収まる', () => {
    const weird = new Map([
      ['p0', -5], // 想定外の負値
      ['p1', 0],
      ['p2', 100],
      ['p3', 3],
    ]);
    const value = computeRecency(courts, weird);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });
});
