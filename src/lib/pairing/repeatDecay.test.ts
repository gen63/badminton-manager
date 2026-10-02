/**
 * 目的6 `variety` の減衰付き共演重み（`repeatDecay.ts`）と `computeVariety` 減衰版の単体テスト。
 * `docs/plans/2026-10-02-variety-decay.md`
 */
import { describe, it, expect } from 'vitest';
import type { Match } from '../../types/match';
import { buildRepeatWeights, freshnessWeight, VARIETY_SHAPE } from './repeatDecay';
import { computeVariety, type CourtPlacement } from './objective';

const pairKey = (a: string, b: string) => [a, b].sort().join(',');
const comboKey = (ids: readonly string[]) => [...ids].sort().join(',');

function match(
  id: number,
  teamA: [string, string],
  teamB: [string, string]
): Match {
  return { id: String(id), courtId: 1, teamA, teamB, scoreA: 0, scoreB: 0, startedAt: id * 1000, finishedAt: id * 1000 + 500 };
}

const emptyCounts = { partner: new Map<string, number>(), opponent: new Map<string, number>() };
const court = (a: [string, string], b: [string, string]): CourtPlacement => ({ courtId: 1, teamA: a, teamB: b });

describe('buildRepeatWeights（試合数ベースの減衰）', () => {
  const decay = 0.5;
  const shape = { mode: 'games' as const, decay };

  it('直後（その後0試合）の共演は重み1、その後に2人が1試合ずつしたら decay^1', () => {
    const history = [
      match(1, ['a', 'b'], ['c', 'd']),
      match(2, ['a', 'e'], ['f', 'g']), // a だけが1試合
    ];
    const w = buildRepeatWeights(history, pairKey, comboKey, shape);
    // a-b: a は後に1試合・b は0試合 → 平均 0.5 試合
    expect(w.pair.get('a,b')).toBeCloseTo(Math.pow(decay, 0.5), 10);
    // c-d: どちらも後に出ていない → 1
    expect(w.pair.get('c,d')).toBeCloseTo(1, 10);
  });

  it('他の人が何試合しても、本人たちが出ていなければ薄まらない（試合数ベース）', () => {
    const history = [
      match(1, ['a', 'b'], ['c', 'd']),
      match(2, ['e', 'f'], ['g', 'h']),
      match(3, ['e', 'g'], ['f', 'h']),
      match(4, ['e', 'h'], ['f', 'g']),
    ];
    const w = buildRepeatWeights(history, pairKey, comboKey, shape);
    expect(w.pair.get('a,b')).toBeCloseTo(1, 10);
  });

  it('2回共演すると重みは足し合わさり、同じ4人はチーム分けを変えても同じ顔ぶれとして数える', () => {
    const history = [
      match(1, ['a', 'b'], ['c', 'd']),
      match(2, ['a', 'c'], ['b', 'd']),
    ];
    const w = buildRepeatWeights(history, pairKey, comboKey, shape);
    // a-b: 1回目の後に a,b とも1試合 → 0.5、2回目 → 1
    expect(w.pair.get('a,b')).toBeCloseTo(1.5, 10);
    expect(w.quad.get('a,b,c,d')).toBeCloseTo(1.5, 10);
  });

  it('mode=off・履歴なし・空きスロット（シングルス）は空', () => {
    expect(buildRepeatWeights([], pairKey, comboKey, shape).pair.size).toBe(0);
    expect(buildRepeatWeights([match(1, ['a', 'b'], ['c', 'd'])], pairKey, comboKey, { mode: 'off', decay }).pair.size).toBe(0);
    expect(buildRepeatWeights([match(1, ['a', ''], ['c', 'd'])], pairKey, comboKey, shape).pair.size).toBe(0);
  });

  it('時刻・Date.now に依存しない（同じ履歴なら同じ結果）', () => {
    const history = [match(1, ['a', 'b'], ['c', 'd']), match(2, ['a', 'e'], ['f', 'g'])];
    const x = buildRepeatWeights(history, pairKey, comboKey, shape);
    const y = buildRepeatWeights(history, pairKey, comboKey, shape);
    expect([...x.pair]).toEqual([...y.pair]);
  });
});

describe('computeVariety（減衰版）', () => {
  const reach = new Map<string, number>();
  const c = court(['a', 'b'], ['c', 'd']);
  const history = (n: number): Match[] => {
    const h: Match[] = [match(1, ['a', 'b'], ['c', 'd'])];
    // a-b-c-d のあと、a だけが n 試合ほど別の人と出る
    for (let i = 0; i < n; i++) h.push(match(i + 2, ['a', `x${i}`], [`y${i}`, `z${i}`]));
    return h;
  };
  const variety = (h: Match[]) =>
    computeVariety([c], emptyCounts, pairKey, reach, buildRepeatWeights(h, pairKey, comboKey));

  it('履歴が無ければ 0', () => {
    expect(variety([])).toBe(0);
  });

  it('遠い過去の共演ほど弱い（4〜5試合前でもゼロにはならない）', () => {
    const near = variety(history(0));
    const mid = variety(history(4));
    const far = variety(history(12));
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
    expect(mid).toBeGreaterThan(0);
  });

  it('繰り返しが重なるほど、増分が大きくなる（凸。1回目の繰り返しは軽い）', () => {
    const once = [match(1, ['a', 'b'], ['x', 'y'])];
    const twice = [...once, match(2, ['a', 'b'], ['z', 'w'])];
    const thrice = [...twice, match(3, ['a', 'b'], ['u', 'v'])];
    const v = (h: Match[]) =>
      computeVariety([court(['a', 'b'], ['c', 'd'])], emptyCounts, pairKey, reach, buildRepeatWeights(h, pairKey, comboKey));
    const d1 = v(once) - v([]);
    const d2 = v(twice) - v(once);
    expect(d2).toBeGreaterThan(d1);
    expect(v(thrice)).toBeGreaterThanOrEqual(v(twice)); // 3回目以降は頭打ちまで下がらない
  });

  it('同じ4人（チーム分けが違っても）は、ペアだけが重なるより強く罰する', () => {
    const sameFour = [match(1, ['a', 'c'], ['b', 'd'])];
    // 4人のうち3人が同じで1人違う（ペア項は3組分だけ）
    const threeSame = [match(1, ['a', 'b'], ['c', 'q'])];
    const v = (h: Match[]) =>
      computeVariety([c], emptyCounts, pairKey, reach, buildRepeatWeights(h, pairKey, comboKey));
    expect(v(sameFour)).toBeGreaterThan(v(threeSame));
  });

  it('mode=off では repeatWeights があっても従来の累計回数で計算する', () => {
    const saved = VARIETY_SHAPE.mode;
    try {
      VARIETY_SHAPE.mode = 'off';
      const counts = { partner: new Map([[pairKey('a', 'b'), 4]]), opponent: new Map<string, number>() };
      const withW = computeVariety([c], counts, pairKey, reach, buildRepeatWeights(history(0), pairKey, comboKey));
      const without = computeVariety([c], counts, pairKey, reach);
      expect(withW).toBe(without);
    } finally {
      VARIETY_SHAPE.mode = saved;
    }
  });
});

describe('3人一致項（過去の1試合と3人以上一致）', () => {
  const c = court(['a', 'b'], ['c', 'd']);
  const reach = new Map(['a', 'b', 'c', 'd', 'q', 'p'].map(id => [id, 5]));
  const cost = (h: Match[]) =>
    computeVariety([c], emptyCounts, pairKey, reach, buildRepeatWeights(h, pairKey, comboKey));

  it('単調: 4人一致 > 直近と3人一致 > 2人以下', () => {
    const four = [match(1, ['a', 'c'], ['b', 'd'])];
    const three = [match(1, ['a', 'b'], ['c', 'q'])];
    const two = [match(1, ['a', 'b'], ['p', 'q'])];
    expect(cost(four)).toBeGreaterThan(cost(three));
    expect(cost(three)).toBeGreaterThan(cost(two));
  });

  it('3人組は1試合から4通り作られ、別々の試合に散らばった共演は3人組にならない', () => {
    const w = buildRepeatWeights([match(1, ['a', 'b'], ['c', 'q'])], pairKey, comboKey);
    expect(w.triple.size).toBe(4);
    expect(w.triple.get('a,b,c')).toBeCloseTo(1, 10);
    const scattered = buildRepeatWeights(
      [match(1, ['a', 'b'], ['p', 'q']), match(2, ['b', 'c'], ['r', 's']), match(3, ['a', 'c'], ['t', 'u'])],
      pairKey, comboKey
    );
    expect(scattered.triple.get('a,b,c') ?? 0).toBe(0);
  });

  it('同じ4人の再演は、3人一致の項と同4人の項の両方に当たる', () => {
    const w = buildRepeatWeights([match(1, ['a', 'c'], ['b', 'd'])], pairKey, comboKey);
    expect(w.quad.get('a,b,c,d')).toBeGreaterThan(0);
    expect([...w.triple.values()].filter(v => v > 0)).toHaveLength(4);
  });

  it('鮮度: 3人がその後に試合を重ねるほど3人一致は軽くなる（0 には張り付かず単調）', () => {
    const v = (n: number) => {
      const h: Match[] = [match(1, ['a', 'b'], ['c', 'q'])];
      for (let i = 0; i < n; i++) {
        h.push(match(10 + i, ['a', `x${i}`], [`y${i}`, `z${i}`]));
        h.push(match(100 + i, ['b', `s${i}`], [`t${i}`, `u${i}`]));
        h.push(match(200 + i, ['c', `v${i}`], [`w${i}`, `r${i}`]));
      }
      return cost(h);
    };
    expect(v(0)).toBeGreaterThan(v(3));
    expect(v(3)).toBeGreaterThan(v(8));
    expect(v(8)).toBeGreaterThan(v(15) - 1e-9);
  });
});

describe('freshnessWeight（3人組の鮮度のS字）', () => {
  it('0試合後は満額で単調非増加（0〜1）', () => {
    expect(freshnessWeight(0)).toBeCloseTo(1, 10);
    let prev = 1;
    for (let s = 0; s <= 30; s += 0.5) {
      const w = freshnessWeight(s);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(prev + 1e-12);
      prev = w;
    }
  });

  it('2試合後 0.89 前後、5試合後 0.53 前後、10試合後 0.06 前後、15試合後ほぼ0', () => {
    expect(freshnessWeight(2)).toBeCloseTo(0.89, 1);
    expect(freshnessWeight(5)).toBeCloseTo(0.53, 1);
    expect(freshnessWeight(10)).toBeCloseTo(0.06, 1);
    expect(freshnessWeight(15)).toBeLessThan(0.01);
  });
});
