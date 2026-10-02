/**
 * 点数表（`SCORE_TABLE`）と、コート単位の採点の単体テスト。
 * `docs/plans/2026-10-02-simplify-scoring.md`
 */
import { describe, it, expect } from 'vitest';
import {
  SCORE_TABLE,
  courtBreakdown,
  courtSpan,
  fairnessPoints,
  genderPoints,
  looseAffinityPoints,
  streakPoints,
  type ScoreContext,
} from './objective';

const dev = (entries: Record<string, number>) => new Map(Object.entries(entries));

function ctxOf(overrides: Partial<ScoreContext> = {}): ScoreContext {
  return {
    deviationById: new Map(),
    genderById: new Map(),
    genderBalanceOn: true,
    preferGenderMix: false,
    tripleWeights: new Map(),
    streakById: new Map(),
    affinityPairs: [],
    needById: new Map(),
    ...overrides,
  };
}

describe('SCORE_TABLE（点数表。各値は偏差何点分の悪さか）', () => {
  it('連続は 2連続目 < 3連続目 < 4連続目以上 と段階的に重い', () => {
    const [second, third, fourth] = SCORE_TABLE.streak;
    expect(second).toBeGreaterThan(0);
    expect(third).toBeGreaterThan(second);
    expect(fourth).toBeGreaterThan(third);
  });

  it('男女比調整 OFF の点数は ON より小さい（0 にはしない）', () => {
    for (const k of ['threeOne', 'split', 'fourZero'] as const) {
      expect(SCORE_TABLE.genderOff[k]).toBeGreaterThan(0);
      expect(SCORE_TABLE.genderOff[k]).toBeLessThan(SCORE_TABLE.genderOn[k]);
    }
  });
});

describe('courtSpan（コート内の偏差の最大−最小）', () => {
  const d = dev({ a: 70, b: 55, c: 50, d: 30 });

  it('最大−最小', () => {
    expect(courtSpan(['a', 'b', 'c', 'd'], d)).toBe(40);
    expect(courtSpan(['b', 'c'], d)).toBe(5);
  });

  it('「必ず」ペアの2人の間は比べない（それ以外との差は残る）', () => {
    expect(courtSpan(['a', 'b', 'c', 'd'], d, [{ a: 'a', b: 'd' }])).toBe(25); // a-c=20, b-d=25, c-d=20, a-b=15
    expect(courtSpan(['a', 'd'], d, [{ a: 'd', b: 'a' }])).toBe(0);
  });

  it('未登録の人は偏差50扱い', () => {
    expect(courtSpan(['a', 'zz'], d)).toBe(20);
  });
});

describe('courtBreakdown', () => {
  it('コート内の最大−最小は 1点につき courtSpan 点。knee を超えた分は courtSpanExcess を上乗せ（大差ほど強く嫌う）', () => {
    const near = courtBreakdown(['a', 'd'], ['b', 'c'], ctxOf({ deviationById: dev({ a: 55, b: 52, c: 50, d: 45 }) }));
    expect(near.span).toBeCloseTo(SCORE_TABLE.courtSpan * 10, 10);
    const far = courtBreakdown(['a', 'd'], ['b', 'c'], ctxOf({ deviationById: dev({ a: 70, b: 52, c: 50, d: 30 }) }));
    const raw = 40;
    expect(far.span).toBeCloseTo(
      SCORE_TABLE.courtSpan * raw + SCORE_TABLE.courtSpanExcess * (raw - SCORE_TABLE.courtSpanKnee),
      10
    );
    // 幅が2倍になれば2倍より重い
    expect(far.span).toBeGreaterThan(2 * near.span);
  });

  it('チーム平均の差は平均偏差1点につき teamDiff 点（= 偏差合計の差 × teamDiff / 2）', () => {
    const b = courtBreakdown(['a', 'b'], ['c', 'd'], ctxOf({ deviationById: dev({ a: 60, b: 50, c: 50, d: 44 }) }));
    // A 合計110 / B 合計94 → 平均差 8
    expect(b.teamDiff).toBeCloseTo(SCORE_TABLE.teamDiff * 8, 10);
    const even = courtBreakdown(['a', 'd'], ['b', 'c'], ctxOf({ deviationById: dev({ a: 60, b: 50, c: 50, d: 40 }) }));
    expect(even.teamDiff).toBe(0);
  });

  it('3人以上一致: 4つの3人組の鮮度つき重みの合計 × tripleRepeat。4人一致は4つの3人組すべてに当たる', () => {
    const tw = new Map([['a,b,c', 1], ['a,b,d', 0.5]]);
    const some = courtBreakdown(['a', 'b'], ['c', 'd'], ctxOf({ tripleWeights: tw }));
    expect(some.triple).toBeCloseTo(SCORE_TABLE.tripleRepeat * 1.5, 10);
    const all = new Map(['a,b,c', 'a,b,d', 'a,c,d', 'b,c,d'].map(k => [k, 1] as const));
    const four = courtBreakdown(['a', 'c'], ['b', 'd'], ctxOf({ tripleWeights: all }));
    expect(four.triple).toBeCloseTo(SCORE_TABLE.tripleRepeat * 4, 10);
    expect(courtBreakdown(['a', 'b'], ['c', 'x'], ctxOf({ tripleWeights: tw })).triple).toBeCloseTo(
      SCORE_TABLE.tripleRepeat * 1,
      10
    );
  });

  it('連続: 出場者それぞれの 2/3/4連続目の点を足す。控えの連続は数えない', () => {
    const b = courtBreakdown(
      ['a', 'b'],
      ['c', 'd'],
      ctxOf({ streakById: new Map([['a', 1], ['b', 2], ['zz', 3]]) })
    );
    expect(b.streak).toBe(SCORE_TABLE.streak[0] + SCORE_TABLE.streak[1]);
  });

  it('ペア希望: 同コートで敵になると pairPref 点、味方なら0', () => {
    const pairs = [{ a: 'a', b: 'c' }];
    expect(courtBreakdown(['a', 'b'], ['c', 'd'], ctxOf({ affinityPairs: pairs })).pairEnemy).toBe(SCORE_TABLE.pairPref);
    expect(courtBreakdown(['a', 'c'], ['b', 'd'], ctxOf({ affinityPairs: pairs })).pairEnemy).toBe(0);
  });

  it('total は内訳の合計', () => {
    const b = courtBreakdown(
      ['a', 'b'],
      ['c', 'd'],
      ctxOf({
        deviationById: dev({ a: 60, b: 50, c: 45, d: 40 }),
        streakById: new Map([['a', 1]]),
        tripleWeights: new Map([['a,b,c', 1]]),
        affinityPairs: [{ a: 'a', b: 'c' }],
      })
    );
    expect(b.total).toBeCloseTo(b.span + b.teamDiff + b.triple + b.streak + b.gender + b.pairEnemy, 10);
    expect(b.total).toBeGreaterThan(0);
  });
});

describe('streakPoints', () => {
  it('連続していない（undefined・0・不正値）は 0', () => {
    expect(streakPoints(undefined)).toBe(0);
    expect(streakPoints(0)).toBe(0);
    expect(streakPoints(NaN)).toBe(0);
  });

  it('streak=1 が2連続目、2が3連続目、3以上は4連続目以上として頭打ち', () => {
    expect(streakPoints(1)).toBe(SCORE_TABLE.streak[0]);
    expect(streakPoints(2)).toBe(SCORE_TABLE.streak[1]);
    expect(streakPoints(3)).toBe(SCORE_TABLE.streak[2]);
    expect(streakPoints(9)).toBe(SCORE_TABLE.streak[2]);
  });
});

describe('genderPoints（男女バランス）', () => {
  const genders = new Map<string, 'M' | 'F' | undefined>([
    ['m0', 'M'], ['m1', 'M'], ['m2', 'M'], ['m3', 'M'],
    ['f0', 'F'], ['f1', 'F'], ['f2', 'F'], ['f3', 'F'],
    ['x0', undefined],
  ]);
  const on = { genderById: genders, genderBalanceOn: true, preferGenderMix: false };
  const off = { ...on, genderBalanceOn: false };

  it('2-2 を MIX×MIX に分ければ 0、男男 vs 女女に分ければ split 点', () => {
    expect(genderPoints(['m0', 'f0'], ['m1', 'f1'], on)).toBe(0);
    expect(genderPoints(['m0', 'm1'], ['f0', 'f1'], on)).toBe(SCORE_TABLE.genderOn.split);
    expect(genderPoints(['f0', 'f1'], ['m0', 'm1'], on)).toBe(SCORE_TABLE.genderOn.split);
  });

  it('3-1（男3女1・男1女3）は threeOne 点。男女比調整 OFF では小さい点になる', () => {
    expect(genderPoints(['m0', 'm1'], ['m2', 'f0'], on)).toBe(SCORE_TABLE.genderOn.threeOne);
    expect(genderPoints(['f0', 'f1'], ['f2', 'm0'], on)).toBe(SCORE_TABLE.genderOn.threeOne);
    expect(genderPoints(['m0', 'm1'], ['m2', 'f0'], off)).toBe(SCORE_TABLE.genderOff.threeOne);
  });

  it('4-0 は preferGenderMix のときだけ fourZero 点（それ以外は 0）', () => {
    expect(genderPoints(['m0', 'm1'], ['m2', 'm3'], on)).toBe(0);
    expect(genderPoints(['m0', 'm1'], ['m2', 'm3'], { ...on, preferGenderMix: true })).toBe(SCORE_TABLE.genderOn.fourZero);
  });

  it('性別未設定がいるコートは判定しない', () => {
    expect(genderPoints(['m0', 'm1'], ['f0', 'x0'], on)).toBe(0);
  });
});

describe('fairnessPoints（試合数の公平性: 控えより試合数が多い人を出す「逆転」）', () => {
  // 試合数換算: a=0, b=0, c=1, d=2。数字が小さいほど先に出すべき人
  const needs = new Map([['a', 0], ['b', 0], ['c', 1], ['d', 2]]);

  it('優先度どおり（試合数の少ない人から出す）なら 0', () => {
    expect(fairnessPoints(['a', 'b'], ['c', 'd'], needs)).toBe(0);
  });

  it('1試合分の逆転ごとに fairnessPerGame 点（出場者×控えの組ごとに数える）', () => {
    // c(1) を出して a(0)・b(0) を控え → 逆転 2 組 × 1試合分
    expect(fairnessPoints(['c'], ['a', 'b'], needs)).toBeCloseTo(SCORE_TABLE.fairnessPerGame * 2, 10);
  });

  it('逆転が大きいほど重い（2試合分は1試合分の2倍より重い）', () => {
    const one = fairnessPoints(['c'], ['a'], needs); // 差1
    const two = fairnessPoints(['d'], ['a'], needs); // 差2
    expect(two).toBeGreaterThan(2 * one);
  });

  it('同じ試合数どうしの入れ替えは 0（同点は不問）', () => {
    expect(fairnessPoints(['a'], ['b'], needs)).toBe(0);
    expect(fairnessPoints(['b'], ['a'], needs)).toBe(0);
  });

  it('後半均等化モードでは lateFairnessMultiplier 倍になる', () => {
    const normal = fairnessPoints(['c'], ['a'], needs);
    expect(fairnessPoints(['c'], ['a'], needs, true)).toBeCloseTo(normal * SCORE_TABLE.lateFairnessMultiplier, 10);
  });
});

describe('looseAffinityPoints（別コート・ベンチで味方になれないペア希望）', () => {
  const pool = new Set(['a', 'b', 'c', 'd', 'e']);
  const pairs = [{ a: 'a', b: 'e' }];

  it('別コート・片方がベンチなら pairPref 点', () => {
    expect(looseAffinityPoints(new Map([['a', 0], ['e', 1]]), pool, pairs)).toBe(SCORE_TABLE.pairPref);
    expect(looseAffinityPoints(new Map([['a', 0]]), pool, pairs)).toBe(SCORE_TABLE.pairPref);
    expect(looseAffinityPoints(new Map(), pool, pairs)).toBe(SCORE_TABLE.pairPref); // 両方ベンチ
  });

  it('同コートなら数えない（味方・敵はコート側の点数で数える）', () => {
    expect(looseAffinityPoints(new Map([['a', 0], ['e', 0]]), pool, pairs)).toBe(0);
  });

  it('プールに居ないペアは対象外', () => {
    expect(looseAffinityPoints(new Map(), pool, [{ a: 'x', b: 'y' }])).toBe(0);
  });
});
