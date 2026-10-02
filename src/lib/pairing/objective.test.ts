/**
 * 目的8 `recency`（連続出場を嫌う）の単体テスト。
 * `docs/plans/2026-10-01-recency-just-finished-streak.md`
 *
 * 目的1〜7 の単体テストは `assignRound.test.ts` にある（このファイルは
 * recency の追加とあわせて新設した）。
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WEIGHTS,
  computeRecency,
  computeSkillGap,
  RANK_GAP_SOFT_SHAPE,
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
  it('既定の形は base=0.4 / growth=8 で、ハードの違反は無し（hardFrom=0）', () => {
    expect(RECENCY_STREAK_SHAPE).toEqual({ base: 0.4, growth: 8, hardFrom: 0 });
  });

  it('既定の形: 2連続目は僅か・3連続目はまあまあ強く・4連続目以上は強く（1人あたりの実効コスト）', () => {
    // 実効コスト = recencyCost × 重み(9.0) / 4。3連続目は 3-1 のコート（1.0 × 3.7）より重い
    expect(DEFAULT_WEIGHTS.recency).toBe(9.0);
    const effective = (streak: number) => (recencyCost(streak) * DEFAULT_WEIGHTS.recency) / 4;
    expect(effective(1)).toBeCloseTo(0.9, 10); // 2連続目
    expect(effective(2)).toBeCloseTo(7.2, 10); // 3連続目
    expect(effective(3)).toBeCloseTo(57.6, 10); // 4連続目
    expect(effective(2)).toBeGreaterThanOrEqual(1.0 * DEFAULT_WEIGHTS.gender);
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

describe('isRecencyViolation（hardFrom 以上の連続目はハードの違反。既定は無効）', () => {
  it('既定（hardFrom=0）は何連続目でも違反にしない（連続はソフトのコストだけで避ける）', () => {
    expect(isRecencyViolation(undefined)).toBe(false);
    expect(isRecencyViolation(2)).toBe(false);
    expect(isRecencyViolation(9)).toBe(false);
  });

  it('hardFrom=3 なら streak 2（今回3連続目）から違反。2連続目までは違反ではない', () => {
    const hard3 = { hardFrom: 3 };
    expect(isRecencyViolation(undefined, hard3)).toBe(false);
    expect(isRecencyViolation(0, hard3)).toBe(false);
    expect(isRecencyViolation(1, hard3)).toBe(false); // 2連続目
    expect(isRecencyViolation(2, hard3)).toBe(true); // 3連続目
    expect(isRecencyViolation(5, hard3)).toBe(true);
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

describe('computeSkillGap（順位幅の凸ペナルティ。docs/plans/2026-10-02-rank-gap-soft.md）', () => {
  // 13人ロースター（ハード制約が掛からない人数）。順位 0〜12、分母 12
  const rank = new Map(Array.from({ length: 13 }, (_, i) => [`p${i}`, i] as const));
  const flat = { knee: 0, slope: 0, regMix: 0 };

  it('slope=0 は従来どおり順位幅の線形（幅 ÷ (人数-1)）', () => {
    const narrow = [court(1, ['p0', 'p3'], ['p1', 'p2'])]; // 幅3
    expect(computeSkillGap(narrow, rank, 13, flat)).toBeCloseTo(3 / 12, 10);
  });

  it('既定の形は knee を超えた幅を二乗で急に重くする（幅が2倍なら2倍より重い）', () => {
    const half = [court(1, ['p0', 'p6'], ['p1', 'p2'])]; // 幅6 → g=0.5
    const full = [court(1, ['p0', 'p12'], ['p1', 'p2'])]; // 幅12 → g=1.0
    const a = computeSkillGap(half, rank, 13);
    const b = computeSkillGap(full, rank, 13);
    expect(b).toBeGreaterThan(2 * a);
    // 幅が knee 以下なら線形のまま
    const small = [court(1, ['p0', 'p3'], ['p1', 'p2'])]; // g=0.25 < 0.3
    expect(computeSkillGap(small, rank, 13)).toBeCloseTo(0.25, 10);
  });

  it('knee を超えると項は 1 を超えうる（クランプしない）', () => {
    const full = [court(1, ['p0', 'p12'], ['p1', 'p2'])];
    expect(computeSkillGap(full, rank, 13)).toBeCloseTo(
      1 + RANK_GAP_SOFT_SHAPE.slope * (1 - RANK_GAP_SOFT_SHAPE.knee) ** 2,
      10
    );
  });

  it('regMix > 0 なら登録順位の幅も混ぜる（formRank だけ狭くても登録上下の同居を嫌う）', () => {
    const form = new Map(Array.from({ length: 13 }, (_, i) => [`p${i}`, 5] as const)); // 全員同順位
    const c = [court(1, ['p0', 'p12'], ['p1', 'p2'])];
    expect(computeSkillGap(c, form, 13, flat, rank)).toBe(0);
    expect(computeSkillGap(c, form, 13, { knee: 0, slope: 0, regMix: 0.5 }, rank)).toBeCloseTo(0.5, 10);
  });
});
