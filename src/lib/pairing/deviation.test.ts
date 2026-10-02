/**
 * 登録レート → 偏差（平均50・SD10）の変換（`deviation.ts`）。
 * `docs/plans/2026-10-02-simplify-scoring.md`
 */
import { describe, it, expect } from 'vitest';
import type { Player } from '../../types/player';
import type { Match } from '../../types/match';
import { buildDeviationById, buildBlendedDeviationById, computeOutlierZ, DAY_ESTIMATE, DEVIATION_Z_CLAMP } from './deviation';

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

describe('buildBlendedDeviationById（当日の試合結果による補正）', () => {
  let seq = 0;
  const match = (a: [string, string], b: [string, string], winner: 'A' | 'B' | null = 'A'): Match => ({
    id: `m${seq++}`, courtId: 1, teamA: a, teamB: b, scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, ...(winner ? { winner } : {}),
  });
  /** u（未設定）が r1,r2（レートあり）と組んで、強い x,y に連戦連勝するくらい強い履歴 */
  const players = [p('r1', 40), p('r2', 50), p('x', 60), p('y', 55), p('u', 0), p('w', 0)];
  const history = (n: number): Match[] =>
    Array.from({ length: n }, () => match(['u', 'r1'], ['x', 'y'])).concat(
      Array.from({ length: n }, () => match(['w', 'r2'], ['x', 'r1'], 'B'))
    );
  const withDay = <T,>(patch: Partial<typeof DAY_ESTIMATE>, fn: () => T): T => {
    const saved = { ...DAY_ESTIMATE };
    Object.assign(DAY_ESTIMATE, patch);
    try { return fn(); } finally { Object.assign(DAY_ESTIMATE, saved); }
  };

  it('履歴が空・勝敗が無い試合だけなら補正しない（登録レート由来の偏差のまま）', () => {
    const base = buildDeviationById(players);
    expect(buildBlendedDeviationById(players, [])).toEqual(base);
    expect(buildBlendedDeviationById(players, [match(['u', 'r1'], ['x', 'y'], null)])).toEqual(base);
  });

  it('レート未設定の人だけが補正される。レートありの人は登録レート由来のまま', () => {
    const base = buildDeviationById(players);
    const d = withDay({ kUnrated: 2, kRated: Infinity, outlierZ: Infinity }, () => buildBlendedDeviationById(players, history(6)));
    for (const id of ['r1', 'r2', 'x', 'y']) expect(d.get(id)).toBe(base.get(id));
    expect(base.get('u')).toBe(50);
    expect(d.get('u')).not.toBe(50);
    expect(d.get('u')!).toBeGreaterThan(50); // 勝ち続けた u は上がる
    expect(d.get('w')!).toBeLessThan(50); // 負け続けた w は下がる
  });

  it('試合数0の未設定者は 50 のまま。試合数が増えるほど推定値に寄る（縮小推定）', () => {
    const only = (n: number) => withDay({ kUnrated: 4 }, () =>
      buildBlendedDeviationById(players, Array.from({ length: n }, () => match(['u', 'r1'], ['x', 'y'])))
    );
    expect(only(0).get('u')).toBe(50);
    expect(buildBlendedDeviationById([...players, p('z', 0)], history(3)).get('z')).toBe(50); // 履歴に居ない
    const dev1 = only(1).get('u')!, dev4 = only(4).get('u')!, dev12 = only(12).get('u')!;
    expect(dev1).toBeGreaterThan(50);
    expect(dev4).toBeGreaterThan(dev1);
    expect(dev12).toBeGreaterThanOrEqual(dev4);
  });

  it('偏差は ±3σ（20〜80）に収まる', () => {
    const d = withDay({ kUnrated: 0, kRated: 0 }, () => buildBlendedDeviationById(players, history(30)));
    for (const v of d.values()) {
      expect(v).toBeGreaterThanOrEqual(50 - 10 * DEVIATION_Z_CLAMP - 1e-9);
      expect(v).toBeLessThanOrEqual(50 + 10 * DEVIATION_Z_CLAMP + 1e-9);
    }
  });

  it('kRated を有限にすると、レートありの人も補正される（0 なら当日推定そのもの）', () => {
    const base = buildDeviationById(players);
    const d = withDay({ kUnrated: 4, kRated: 5 }, () => buildBlendedDeviationById(players, history(6)));
    expect(d.get('x')).not.toBe(base.get('x'));
    const full = withDay({ kRated: 0 }, () => buildBlendedDeviationById(players, history(6)));
    expect(full.get('x')).not.toBeCloseTo(base.get('x')!, 3);
  });

  it('決定的: 同じ入力なら同じ結果（Date.now に依存しない）', () => {
    const a = buildBlendedDeviationById(players, history(5));
    const realNow = Date.now;
    Date.now = () => 123456789;
    try {
      expect(buildBlendedDeviationById(players, history(5))).toEqual(a);
    } finally {
      Date.now = realNow;
    }
  });

  it('全員レートありで kRated が無限大なら、履歴があっても登録レート由来の偏差と完全に同じ', () => {
    const rated = [p('a', 40), p('b', 50), p('c', 60), p('d', 55)];
    const ms = [match(['a', 'b'], ['c', 'd']), match(['a', 'c'], ['b', 'd'], 'B')];
    expect(buildBlendedDeviationById(rated, ms)).toEqual(buildDeviationById(rated));
  });
});

describe('レートありの外れ値補正（成績が偶然の範囲を大きく超えたときだけ）', () => {
  let seq = 0;
  const match = (a: [string, string], b: [string, string], winner: 'A' | 'B'): Match => ({
    id: `o${seq++}`, courtId: 1, teamA: a, teamB: b, scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner,
  });
  // 偏差 40 / 45 / 50 / 55 / 60 の5人 + 未設定1人。m（50）が主役
  const players = [p('lo', 40), p('lo2', 45), p('m', 50), p('hi2', 55), p('hi', 60), p('u', 0)];
  /** 登録の見込みどおり: 強い側が勝つ（m は期待どおり） */
  const asExpected: Match[] = [
    match(['hi', 'hi2'], ['lo', 'lo2'], 'A'), match(['hi', 'm'], ['lo', 'lo2'], 'A'),
    match(['m', 'hi2'], ['lo', 'lo2'], 'A'), match(['hi', 'lo'], ['hi2', 'lo2'], 'A'),
    match(['m', 'lo'], ['hi', 'lo2'], 'B'), match(['m', 'lo2'], ['hi', 'hi2'], 'B'),
    match(['m', 'lo'], ['hi2', 'lo2'], 'A'), match(['hi', 'm'], ['hi2', 'lo2'], 'A'),
  ];
  /** m が自分より強い人たちに勝ち続ける（登録からの期待を大きく超える） */
  const mHot: Match[] = [
    ...Array.from({ length: 10 }, () => match(['m', 'lo'], ['hi', 'hi2'], 'A')),
    match(['hi', 'lo2'], ['hi2', 'lo'], 'A'), match(['hi', 'hi2'], ['lo', 'lo2'], 'A'),
  ];
  /** m が自分より弱い人たちに負け続ける */
  const mCold: Match[] = [
    ...Array.from({ length: 10 }, () => match(['m', 'hi'], ['lo', 'lo2'], 'B')),
    match(['hi', 'lo2'], ['hi2', 'lo'], 'A'), match(['hi', 'hi2'], ['lo', 'lo2'], 'A'),
  ];
  const withDay = <T,>(patch: Partial<typeof DAY_ESTIMATE>, fn: () => T): T => {
    const saved = { ...DAY_ESTIMATE };
    Object.assign(DAY_ESTIMATE, patch);
    try { return fn(); } finally { Object.assign(DAY_ESTIMATE, saved); }
  };
  const settings = { kUnrated: 4, kRated: Infinity, outlierZ: 2, outlierK: 1, outlierCap: 15, outlierMinGames: 5 };

  it('computeOutlierZ: 見込みどおりの人は |z| が小さく、期待を大きく超えた人は大きい', () => {
    const prior = buildDeviationById(players);
    const asExp = computeOutlierZ(prior, asExpected);
    expect(Math.abs(asExp.get('m')!.z)).toBeLessThan(2);
    expect(computeOutlierZ(prior, mHot).get('m')!.z).toBeGreaterThan(2);
    expect(computeOutlierZ(prior, mCold).get('m')!.z).toBeLessThan(-2);
  });

  it('普段どおりの成績なら、レートありの人は補正されない', () => {
    const base = buildDeviationById(players);
    const d = withDay(settings, () => buildBlendedDeviationById(players, asExpected));
    for (const id of ['lo', 'lo2', 'm', 'hi2', 'hi']) expect(d.get(id)).toBe(base.get(id));
  });

  it('2σ を超えて好調な人は上方向に、不調な人は下方向に補正される', () => {
    const base = buildDeviationById(players);
    const hot = withDay(settings, () => buildBlendedDeviationById(players, mHot));
    const cold = withDay(settings, () => buildBlendedDeviationById(players, mCold));
    expect(hot.get('m')!).toBeGreaterThan(base.get('m')!);
    expect(cold.get('m')!).toBeLessThan(base.get('m')!);
  });

  it('しきい値を高くするほど補正されにくい（Infinity で無効）', () => {
    const base = buildDeviationById(players);
    const off = withDay({ ...settings, outlierZ: Infinity }, () => buildBlendedDeviationById(players, mHot));
    expect(off.get('m')).toBe(base.get('m'));
    const zStrict = computeOutlierZ(base, mHot).get('m')!.z + 0.1;
    const strict = withDay({ ...settings, outlierZ: zStrict }, () => buildBlendedDeviationById(players, mHot));
    expect(strict.get('m')).toBe(base.get('m'));
  });

  it('超過が大きいほど補正も大きい（ソフトしきい値）', () => {
    const base = buildDeviationById(players);
    const shift = (z: number) => withDay({ ...settings, outlierZ: z }, () => buildBlendedDeviationById(players, mHot)).get('m')! - base.get('m')!;
    const zm = computeOutlierZ(base, mHot).get('m')!.z;
    expect(shift(zm - 0.3)).toBeGreaterThan(0);
    expect(shift(zm - 1.5)).toBeGreaterThan(shift(zm - 0.3));
  });

  it('補正は登録偏差から outlierCap までに抑える', () => {
    const base = buildDeviationById(players);
    const free = withDay({ ...settings, outlierK: 0, outlierCap: 100 }, () => buildBlendedDeviationById(players, mHot));
    const gap = free.get('m')! - base.get('m')!;
    expect(gap).toBeGreaterThan(2);
    const capped = withDay({ ...settings, outlierK: 0, outlierCap: 2 }, () => buildBlendedDeviationById(players, mHot));
    expect(capped.get('m')! - base.get('m')!).toBeCloseTo(2, 10);
    const coldCapped = withDay({ ...settings, outlierK: 0, outlierCap: 2 }, () => buildBlendedDeviationById(players, mCold));
    expect(base.get('m')! - coldCapped.get('m')!).toBeCloseTo(2, 10);
  });

  it('試合数が outlierMinGames 未満なら補正しない', () => {
    const base = buildDeviationById(players);
    const few = mHot.slice(0, 3);
    const d = withDay({ ...settings, outlierZ: 0 }, () => buildBlendedDeviationById(players, few));
    expect(d.get('m')).toBe(base.get('m'));
  });

  it('レート未設定の人の扱いは外れ値補正の有無で変わらない（kUnrated=4 のまま）', () => {
    const history: Match[] = [...mHot, ...Array.from({ length: 6 }, () => match(['u', 'hi'], ['lo', 'lo2'], 'A'))];
    const off = withDay({ ...settings, outlierZ: Infinity }, () => buildBlendedDeviationById(players, history));
    const on = withDay(settings, () => buildBlendedDeviationById(players, history));
    expect(on.get('u')).toBe(off.get('u'));
    expect(on.get('u')!).toBeGreaterThan(50);
  });

  it('決定的: 同じ入力なら同じ結果（Date.now に依存しない）', () => {
    const a = withDay(settings, () => buildBlendedDeviationById(players, mHot));
    const realNow = Date.now;
    Date.now = () => 987654321;
    try {
      expect(withDay(settings, () => buildBlendedDeviationById(players, mHot))).toEqual(a);
    } finally {
      Date.now = realNow;
    }
  });
});
