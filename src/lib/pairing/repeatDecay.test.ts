/**
 * 「3人以上一致」の鮮度つき重み（`repeatDecay.ts`）の単体テスト。
 * `docs/plans/2026-10-02-simplify-scoring.md`（鮮度の形は 2026-10-02-variety-decay.md）
 */
import { describe, it, expect } from 'vitest';
import type { Match } from '../../types/match';
import { buildTripleWeights, comboKey, freshnessWeight } from './repeatDecay';

function match(id: number, teamA: [string, string], teamB: [string, string]): Match {
  return { id: String(id), courtId: 1, teamA, teamB, scoreA: 0, scoreB: 0, startedAt: id * 1000, finishedAt: id * 1000 + 500 };
}

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

describe('buildTripleWeights', () => {
  it('履歴なし・空きスロット（シングルス）は空', () => {
    expect(buildTripleWeights([]).size).toBe(0);
    expect(buildTripleWeights([match(1, ['a', ''], ['c', 'd'])]).size).toBe(0);
  });

  it('3人組は1試合から4通り作られ、直後は鮮度 1', () => {
    const w = buildTripleWeights([match(1, ['a', 'b'], ['c', 'd'])]);
    expect(w.size).toBe(4);
    for (const key of ['a,b,c', 'a,b,d', 'a,c,d', 'b,c,d']) expect(w.get(key)).toBeCloseTo(1, 10);
  });

  it('別々の試合に散らばった共演は3人組にならない', () => {
    const w = buildTripleWeights([
      match(1, ['a', 'b'], ['p', 'q']),
      match(2, ['b', 'c'], ['r', 's']),
      match(3, ['a', 'c'], ['t', 'u']),
    ]);
    expect(w.get('a,b,c') ?? 0).toBe(0);
  });

  it('同じ4人は4つの3人組すべてに当たる（チーム分けが違っても同じ）', () => {
    const w = buildTripleWeights([match(1, ['a', 'c'], ['b', 'd'])]);
    expect([...w.values()].filter(v => v > 0)).toHaveLength(4);
    expect(w.get(comboKey(['b', 'c', 'a']))).toBeGreaterThan(0);
  });

  it('鮮度: 3人がその後に試合を重ねるほど軽くなる（単調）', () => {
    const weightAfter = (n: number) => {
      const h: Match[] = [match(1, ['a', 'b'], ['c', 'q'])];
      for (let i = 0; i < n; i++) {
        h.push(match(10 + i, ['a', `x${i}`], [`y${i}`, `z${i}`]));
        h.push(match(100 + i, ['b', `s${i}`], [`t${i}`, `u${i}`]));
        h.push(match(200 + i, ['c', `v${i}`], [`w${i}`, `r${i}`]));
      }
      return buildTripleWeights(h).get('a,b,c')!;
    };
    expect(weightAfter(0)).toBeGreaterThan(weightAfter(3));
    expect(weightAfter(3)).toBeGreaterThan(weightAfter(8));
    expect(weightAfter(8)).toBeGreaterThanOrEqual(weightAfter(15));
  });

  it('同じ3人組が何度出ても足し込まず、いちばん新しい共演の鮮度だけを採る（上限 1）', () => {
    const h = [
      match(1, ['a', 'b'], ['c', 'd']),
      match(2, ['a', 'b'], ['c', 'e']),
      match(3, ['a', 'b'], ['c', 'f']),
    ];
    const w = buildTripleWeights(h);
    expect(w.get('a,b,c')).toBeCloseTo(1, 10); // 3回出ていても 3 にはならない
  });

  it('時刻・Date.now に依存しない（同じ履歴なら同じ結果）', () => {
    const history = [match(1, ['a', 'b'], ['c', 'd']), match(2, ['a', 'e'], ['f', 'g'])];
    expect([...buildTripleWeights(history)]).toEqual([...buildTripleWeights(history)]);
  });
});
