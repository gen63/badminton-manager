/**
 * 登録レート → 偏差（平均50・SD10）の変換（`deviation.ts`）。
 * `docs/plans/2026-10-02-simplify-scoring.md`
 */
import { describe, it, expect } from 'vitest';
import type { Player } from '../../types/player';
import { buildDeviationById, DEVIATION_Z_CLAMP } from './deviation';

const p = (id: string, rating: number | undefined): Pick<Player, 'id' | 'rating'> => ({ id, rating: rating as number });

describe('buildDeviationById', () => {
  it('平均50・SD10 に標準化され、高レートほど大きい', () => {
    const d = buildDeviationById([p('a', 40), p('b', 50), p('c', 60)]);
    expect(d.get('b')).toBeCloseTo(50, 10);
    expect(d.get('c')!).toBeGreaterThan(50);
    expect(d.get('a')!).toBeCloseTo(100 - d.get('c')!, 10);
    const values = [...d.values()];
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
    expect(mean).toBeCloseTo(50, 10);
    expect(sd).toBeCloseTo(10, 10);
  });

  it('レートの単位に依存しない（偏差でも Elo でも同じ偏差）', () => {
    const a = buildDeviationById([p('a', 40), p('b', 50), p('c', 80)]);
    const b = buildDeviationById([p('a', 1400), p('b', 1500), p('c', 1800)]);
    for (const id of ['a', 'b', 'c']) expect(a.get(id)).toBeCloseTo(b.get(id)!, 10);
  });

  it('端の人は隣との順位差が1でも、レートが離れていればその分だけ離れる（順位では測れない差）', () => {
    const d = buildDeviationById([p('a', 50), p('b', 52), p('c', 54), p('d', 56), p('e', 24)]);
    const near = Math.abs(d.get('a')! - d.get('b')!);
    const far = Math.abs(d.get('d')! - d.get('e')!);
    expect(far).toBeGreaterThan(5 * near);
  });

  it('外れ値は偏差 50±10×3（20〜80）で丸める', () => {
    const many = Array.from({ length: 30 }, (_, i) => p(`n${i}`, 50));
    const d = buildDeviationById([...many, p('x', 5000)]);
    expect(d.get('x')!).toBeCloseTo(50 + 10 * DEVIATION_Z_CLAMP, 10);
  });

  it('未設定レート（0 / undefined）は平均扱いで 50。全員同レートなら全員 50', () => {
    const d = buildDeviationById([p('a', 40), p('b', 60), p('u', 0), p('v', undefined)]);
    expect(d.get('u')).toBe(50);
    expect(d.get('v')).toBe(50);
    const same = buildDeviationById([p('a', 1500), p('b', 1500)]);
    expect([...same.values()]).toEqual([50, 50]);
  });
});
