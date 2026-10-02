/**
 * 目的8 `recency`（連続出場を嫌う）の単体テスト。
 * `docs/plans/2026-10-01-recency-just-finished-streak.md`
 *
 * 目的1〜7 の単体テストは `assignRound.test.ts` にある（このファイルは
 * recency の追加とあわせて新設した）。
 */
import { describe, it, expect } from 'vitest';
import {
  computeRecency,
  recencyCost,
  isRecencyViolation,
  RECENCY_STREAK_SHAPE,
  type CourtPlacement,
} from './objective';

function court(
  courtId: number,
  teamA: [string, string],
  teamB: [string, string]
): CourtPlacement {
  return { courtId, teamA, teamB };
}

const shape = { base: 1, growth: 4 };

describe('recencyCost（今回何連続目になるか → コスト。飽和しない段階的な形）', () => {
  it('既定の形は base=1 / growth=4 / 3連続目以上を違反にする', () => {
    expect(RECENCY_STREAK_SHAPE).toEqual({ base: 1, growth: 4, hardFrom: 3 });
  });

  it('連続していない（streak 0・未出場・不正値）は 0', () => {
    expect(recencyCost(0, shape)).toBe(0);
    expect(recencyCost(-1, shape)).toBe(0);
    expect(recencyCost(NaN, shape)).toBe(0);
  });

  it('streak=1（今回2連続目）は軽く、3連続目・4連続目と段階的に増える', () => {
    expect(recencyCost(1, shape)).toBe(1); // 2連続目
    expect(recencyCost(2, shape)).toBe(4); // 3連続目
    expect(recencyCost(3, shape)).toBe(16); // 4連続目
  });

  it('飽和しない（連続回数が増えるほど単調に増え続ける）', () => {
    let prev = 0;
    for (let streak = 1; streak <= 8; streak++) {
      const c = recencyCost(streak, shape);
      expect(c).toBeGreaterThan(prev);
      prev = c;
    }
  });

  it('base / growth を変えると傾きが変わる（growth<1 でも減らない）', () => {
    expect(recencyCost(2, { base: 0.5, growth: 10 })).toBeCloseTo(5, 10);
    expect(recencyCost(3, { base: 1, growth: 0.1 })).toBe(1); // growth は最低 1 として扱う
  });
});

describe('isRecencyViolation（3連続目以上はハードの違反）', () => {
  it('既定: streak 2（今回3連続目）から違反。2連続目までは違反ではない', () => {
    expect(isRecencyViolation(undefined)).toBe(false);
    expect(isRecencyViolation(0)).toBe(false);
    expect(isRecencyViolation(1)).toBe(false); // 2連続目
    expect(isRecencyViolation(2)).toBe(true); // 3連続目
    expect(isRecencyViolation(5)).toBe(true);
  });

  it('hardFrom=0 なら無効（ソフトのコストだけで測るとき）', () => {
    expect(isRecencyViolation(9, { hardFrom: 0 })).toBe(false);
  });
});

describe('computeRecency（配置された全員のコストを1コート=4人で正規化して合算）', () => {
  const courts = [court(1, ['p0', 'p1'], ['p2', 'p3'])];

  it('連続候補がいなければ 0（Map が空・全員 0）', () => {
    expect(computeRecency(courts, new Map(), shape)).toBe(0);
    expect(computeRecency(courts, new Map([['p0', 0]]), shape)).toBe(0);
  });

  it('1人が2連続目になるなら 1/4、3連続目なら 4/4、4連続目なら 16/4', () => {
    expect(computeRecency(courts, new Map([['p0', 1]]), shape)).toBeCloseTo(0.25, 10);
    expect(computeRecency(courts, new Map([['p0', 2]]), shape)).toBeCloseTo(1, 10);
    expect(computeRecency(courts, new Map([['p0', 3]]), shape)).toBeCloseTo(4, 10);
  });

  it('配置されていない人（控え）の streak は数えない', () => {
    expect(computeRecency(courts, new Map([['bench', 3]]), shape)).toBe(0);
  });

  it('複数コートでも1人あたりの効きは変わらない（配置人数では割らない）', () => {
    const one = computeRecency(courts, new Map([['p0', 2]]), shape);
    const two = computeRecency(
      [...courts, court(2, ['p4', 'p5'], ['p6', 'p7'])],
      new Map([['p0', 2]]),
      shape
    );
    expect(two).toBeCloseTo(one, 10);
  });

  it('全員が2連続目なら 4 人 × 1 / 4 = 1', () => {
    const all = new Map(['p0', 'p1', 'p2', 'p3'].map(id => [id, 1] as const));
    expect(computeRecency(courts, all, shape)).toBeCloseTo(1, 10);
  });

  it('コートが無ければ 0（練習開始直後・0除算しない）', () => {
    expect(computeRecency([], new Map([['p0', 9]]), shape)).toBe(0);
  });
});
