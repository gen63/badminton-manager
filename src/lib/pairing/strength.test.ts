/**
 * 登録レートの数値ベースの強さ（`strength.ts`）と、それを使う skillGap / competitive /
 * 局所探索の振る舞い。`docs/plans/2026-10-02-rating-based-strength.md`
 */
import { describe, it, expect } from 'vitest';
import type { Player } from '../../types/player';
import { buildStrengthById, buildFormStrengthById, STRENGTH_SHAPE } from './strength';
import {
  computeSkillGap,
  computeCompetitive,
  numericTeamDiff,
  type CourtPlacement,
} from './objective';
import { assignRoundByObjective } from './assignRound';

const p = (id: string, rating: number | undefined): Pick<Player, 'id' | 'rating'> => ({ id, rating: rating as number });

describe('buildStrengthById', () => {
  it('標準化（平均 0）で、高レートほど大きい', () => {
    const s = buildStrengthById([p('a', 40), p('b', 50), p('c', 60)]);
    expect(s.get('b')).toBeCloseTo(0, 10);
    expect(s.get('c')!).toBeGreaterThan(0);
    expect(s.get('a')!).toBeCloseTo(-s.get('c')!, 10);
  });

  it('レートの単位に依存しない（偏差でも Elo でも同じ強さ）', () => {
    const a = buildStrengthById([p('a', 40), p('b', 50), p('c', 80)]);
    const b = buildStrengthById([p('a', 1400), p('b', 1500), p('c', 1800)]);
    for (const id of ['a', 'b', 'c']) expect(a.get(id)).toBeCloseTo(b.get(id)!, 10);
  });

  it('端の人は隣との順位差が1でも、レートが離れていればその分だけ離れる（順位では測れない差）', () => {
    // 順位は 0,1,2,3,4 の等間隔だが、レートは最後の1人だけ大きく離れている
    const s = buildStrengthById([p('a', 50), p('b', 52), p('c', 54), p('d', 56), p('e', 24)]);
    const near = Math.abs(s.get('a')! - s.get('b')!);
    const far = Math.abs(s.get('d')! - s.get('e')!);
    expect(far).toBeGreaterThan(5 * near);
  });

  it('外れ値は zClamp で丸める', () => {
    const many = Array.from({ length: 30 }, (_, i) => p(`n${i}`, 50));
    const s = buildStrengthById([...many, p('x', 5000)]);
    expect(Math.abs(s.get('x')!)).toBeLessThanOrEqual(STRENGTH_SHAPE.zClamp / STRENGTH_SHAPE.zSpan + 1e-9);
  });

  it('未設定レート（0 / undefined）は平均扱いで 0。全員同レートなら全員 0', () => {
    const s = buildStrengthById([p('a', 40), p('b', 60), p('u', 0), p('v', undefined)]);
    expect(s.get('u')).toBe(0);
    expect(s.get('v')).toBe(0);
    const same = buildStrengthById([p('a', 1500), p('b', 1500)]);
    expect([...same.values()]).toEqual([0, 0]);
  });
});

describe('buildFormStrengthById（当日の勝敗補正）', () => {
  const strength = new Map([['a', 0.2], ['b', 0]]);
  const base = new Map([['a', 0], ['b', 1]]);
  const form = new Map([['a', 1], ['b', 0]]); // ハシゴ式で入れ替わった

  it('ladder=0 は登録レートのままの強さ（同じ Map）', () => {
    expect(buildFormStrengthById(strength, base, form, 0)).toBe(strength);
  });

  it('ladder>0 は順位が上がった人を強く、下がった人を弱くする', () => {
    const f = buildFormStrengthById(strength, base, form, 1);
    expect(f.get('b')!).toBeGreaterThan(strength.get('b')!);
    expect(f.get('a')!).toBeLessThan(strength.get('a')!);
    expect(f.get('b')! - strength.get('b')!).toBeCloseTo(1, 10); // 順位1つ ÷（人数−1=1）
  });
});

const court = (teamA: [string, string], teamB: [string, string]): CourtPlacement => ({
  courtId: 1,
  teamA,
  teamB,
});

describe('computeSkillGap / computeCompetitive の数値ベース', () => {
  // 順位は 0..4 の等間隔だが、p4 だけレートが大きく離れている
  const players = [p('p0', 56), p('p1', 54), p('p2', 52), p('p3', 50), p('p4', 24)];
  const strength = buildStrengthById(players);
  const rank = new Map(players.map((x, i) => [x.id, i] as const));
  const shape = { knee: 0.3, slope: 10, regMix: 0 };

  it('gapMix=0（またはなし）は従来の順位ベースと一致する', () => {
    const c = [court(['p0', 'p4'], ['p1', 'p2'])];
    const rankOnly = computeSkillGap(c, rank, 5, shape);
    expect(computeSkillGap(c, rank, 5, shape, undefined, { strengthById: strength, formStrengthById: strength, gapMix: 0 })).toBe(rankOnly);
  });

  it('順位幅が同じでも、端の人を含むコートのほうが数値ベースでは重く罰される', () => {
    const withOutlier = [court(['p4', 'p3'], ['p2', 'p1'])]; // 順位幅 3、p4 だけ大きく離れている
    const noOutlier = [court(['p0', 'p1'], ['p2', 'p3'])]; // 順位幅 3
    const num = { strengthById: strength, formStrengthById: strength, gapMix: 1 };
    expect(computeSkillGap(withOutlier, rank, 5, shape)).toBeCloseTo(computeSkillGap(noOutlier, rank, 5, shape), 10);
    expect(computeSkillGap(withOutlier, rank, 5, shape, undefined, num)).toBeGreaterThan(
      2 * computeSkillGap(noOutlier, rank, 5, shape, undefined, num)
    );
  });

  it('competitive: 順位和が同じでもレート差でチームの釣り合いが変わる', () => {
    // 順位和: A=p0+p4=4, B=p1+p3=4 で順位ベースでは差 0。数値ではレート差が出る
    const c = [court(['p0', 'p4'], ['p1', 'p3'])];
    expect(computeCompetitive(c, rank, 5)).toBe(0);
    expect(computeCompetitive(c, rank, 5, { formStrengthById: strength, compMix: 1 })).toBeGreaterThan(0);
    // compMix=0 は順位ベースのまま
    expect(computeCompetitive(c, rank, 5, { formStrengthById: strength, compMix: 0 })).toBe(0);
  });

  it('numericTeamDiff は強さ合計の差の絶対値', () => {
    const m = new Map([['a', 0.3], ['b', 0.1], ['c', 0.2], ['d', 0]]);
    expect(numericTeamDiff(['a', 'b'], ['c', 'd'], m)).toBeCloseTo(0.2, 10);
  });
});

describe('assignRoundByObjective: 数値の強さでチーム分けする', () => {
  it('4人の順位が等間隔でも、レートで釣り合うチームに分ける（強い人どうし/弱い人どうしを組ませない）', () => {
    // a=60, b=40 の2人が飛び抜けて離れ、c=51, d=49 は中間。順位ベースでは 0,1,2,3 の等間隔
    const ratings: Record<string, number> = { a: 60, b: 40, c: 51, d: 49 };
    const candidates = Object.keys(ratings).map(id => ({
      id,
      name: id,
      gamesPlayed: 0,
      rating: ratings[id],
      isResting: false,
      lastPlayedAt: 0,
      activatedAt: 0,
    })) as Player[];
    const strength = buildStrengthById(candidates);
    const rankById = new Map([['a', 0], ['c', 1], ['d', 2], ['b', 3]]);
    const [assignment] = assignRoundByObjective({
      candidates,
      courtIds: [1],
      rankById,
      strengthById: strength,
      rosterSize: 4,
      priorityScoreOf: () => 0,
      pairCounts: { partner: new Map(), opponent: new Map() },
      pairKeyOf: (x, y) => [x, y].sort().join(','),
      wideSpanThreshold: null,
      preferGenderMix: false,
    });
    const sum = (ids: string[]) => ids.reduce((s, id) => s + ratings[id], 0);
    // 最も釣り合う分け方（a+b vs c+d: 差 0）が選ばれる
    expect(Math.abs(sum(assignment.teamA) - sum(assignment.teamB))).toBe(0);
  });
});
