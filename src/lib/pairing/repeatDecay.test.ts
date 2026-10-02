/**
 * 目的6 `variety` の減衰付き共演重み（`repeatDecay.ts`）と `computeVariety` 減衰版の単体テスト。
 * `docs/plans/2026-10-02-variety-decay.md`
 */
import { describe, it, expect } from 'vitest';
import type { Match } from '../../types/match';
import { buildRepeatWeights, VARIETY_SHAPE } from './repeatDecay';
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
