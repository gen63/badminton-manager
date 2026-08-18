import { describe, it, expect } from 'vitest';
import { assignRoundByObjective } from './assignRound';
import {
  computeMixSplit,
  computeVariety,
  computeObjectiveTerms,
  type CourtPlacement,
  type PairCounts,
} from './objective';
import type { Player } from '../../types/player';

function makePlayer(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    name: id,
    gamesPlayed: 0,
    rating: 1500,
    isResting: false,
    lastPlayedAt: 0,
    activatedAt: 0,
    ...overrides,
  };
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join(',');
}

function emptyPairCounts(): PairCounts {
  return { partner: new Map(), opponent: new Map() };
}

/** priorityScoreOf: id の数字部分をそのままスコアに使う（p0 が最優先） */
function priorityScoreOf(p: Player): number {
  return Number(p.id.replace('p', ''));
}

function rankByIdFrom(ids: string[]): Map<string, number> {
  return new Map(ids.map((id, index) => [id, index]));
}

describe('assignRoundByObjective', () => {
  it('4人×コート数が必ず配置される', () => {
    const candidates = Array.from({ length: 12 }, (_, i) => makePlayer(`p${i}`));
    const rankById = rankByIdFrom(candidates.map(p => p.id));
    const result = assignRoundByObjective({
      candidates,
      courtIds: [1, 2, 3],
      rankById,
      rosterSize: 12,
      priorityScoreOf,
      pairCounts: emptyPairCounts(),
      pairKeyOf: pairKey,
      isRecentDuplicate: () => false,
      wideSpanThreshold: null,
      preferGenderMix: false,
    });

    expect(result).toHaveLength(3);
    const allIds = result.flatMap(c => [...c.teamA, ...c.teamB]);
    expect(new Set(allIds).size).toBe(12); // 重複なし
    expect(result.map(c => c.courtId).sort()).toEqual([1, 2, 3]);
  });

  it('同じ入力で必ず同じ出力（決定性）', () => {
    const candidates = Array.from({ length: 16 }, (_, i) =>
      makePlayer(`p${i}`, { gender: i % 3 === 0 ? 'F' : 'M' })
    );
    const rankById = rankByIdFrom(candidates.map(p => p.id));
    const pairCounts: PairCounts = {
      partner: new Map([[pairKey('p0', 'p1'), 2]]),
      opponent: new Map([[pairKey('p2', 'p3'), 1]]),
    };

    const run = () =>
      assignRoundByObjective({
        candidates,
        courtIds: [1, 2, 3, 4],
        rankById,
        rosterSize: 16,
        priorityScoreOf,
        pairCounts,
        pairKeyOf: pairKey,
        isRecentDuplicate: (ids) => ids.includes('p5') && ids.includes('p6'),
        wideSpanThreshold: Math.ceil(16 * (2 / 3)),
        preferGenderMix: false,
      });

    const a = run();
    const b = run();
    expect(a).toEqual(b);
  });

  it('ハード制約（順位差）を満たす解があるとき、それが選ばれる', () => {
    // 16人・4コート。優先度順に並べると素直な初期解では順位差が大きい
    // 組み合わせが生じうるが、閾値を満たす解が必ず存在する人数構成にしてある。
    const candidates = Array.from({ length: 16 }, (_, i) => makePlayer(`p${i}`));
    const rankById = rankByIdFrom(candidates.map(p => p.id));
    const wideSpanThreshold = Math.ceil(16 * (2 / 3)); // 11

    const result = assignRoundByObjective({
      candidates,
      courtIds: [1, 2, 3, 4],
      rankById,
      rosterSize: 16,
      priorityScoreOf,
      pairCounts: emptyPairCounts(),
      pairKeyOf: pairKey,
      isRecentDuplicate: () => false,
      wideSpanThreshold,
      preferGenderMix: false,
    });

    for (const court of result) {
      const ids = [...court.teamA, ...court.teamB];
      const ranks = ids.map(id => rankById.get(id)!);
      const gap = Math.max(...ranks) - Math.min(...ranks);
      expect(gap).toBeLessThan(wideSpanThreshold);
    }
  });

  it('ハード制約（直近重複）を満たす解があるとき、それが選ばれる', () => {
    const candidates = Array.from({ length: 8 }, (_, i) => makePlayer(`p${i}`));
    const rankById = rankByIdFrom(candidates.map(p => p.id));
    // p0,p1,p2,p3 の組み合わせだけを直近重複として禁止する
    const forbidden = new Set(['p0', 'p1', 'p2', 'p3']);
    const isRecentDuplicate = (ids: string[]): boolean =>
      ids.every(id => forbidden.has(id));

    const result = assignRoundByObjective({
      candidates,
      courtIds: [1, 2],
      rankById,
      rosterSize: 8,
      priorityScoreOf,
      pairCounts: emptyPairCounts(),
      pairKeyOf: pairKey,
      isRecentDuplicate,
      wideSpanThreshold: null,
      preferGenderMix: false,
    });

    for (const court of result) {
      const ids = [...court.teamA, ...court.teamB];
      expect(isRecentDuplicate(ids)).toBe(false);
    }
  });

  it('解が存在しないとき例外を投げず、違反最小の解を返す', () => {
    // 4人しかいないので、全員を1コートに入れざるを得ない。順位差の閾値を極端に
    // 小さくして、どんな組み合わせでも必ず違反するようにする。
    const candidates = Array.from({ length: 4 }, (_, i) => makePlayer(`p${i}`));
    const rankById = rankByIdFrom(candidates.map(p => p.id));

    expect(() =>
      assignRoundByObjective({
        candidates,
        courtIds: [1],
        rankById,
        rosterSize: 4,
        priorityScoreOf,
        pairCounts: emptyPairCounts(),
        pairKeyOf: pairKey,
        isRecentDuplicate: () => false,
        wideSpanThreshold: 1, // 順位差1以上で違反 → 4人いる限り必ず違反する
        preferGenderMix: false,
      })
    ).not.toThrow();

    const result = assignRoundByObjective({
      candidates,
      courtIds: [1],
      rankById,
      rosterSize: 4,
      priorityScoreOf,
      pairCounts: emptyPairCounts(),
      pairKeyOf: pairKey,
      isRecentDuplicate: () => false,
      wideSpanThreshold: 1,
      preferGenderMix: false,
    });

    expect(result).toHaveLength(1);
    const ids = [...result[0].teamA, ...result[0].teamB];
    expect(new Set(ids).size).toBe(4);
  });

  it('全員が直近重複として禁止されていても例外を投げず配置する', () => {
    const candidates = Array.from({ length: 4 }, (_, i) => makePlayer(`p${i}`));
    const rankById = rankByIdFrom(candidates.map(p => p.id));

    const result = assignRoundByObjective({
      candidates,
      courtIds: [1],
      rankById,
      rosterSize: 4,
      priorityScoreOf,
      pairCounts: emptyPairCounts(),
      pairKeyOf: pairKey,
      isRecentDuplicate: () => true, // どの組も必ず違反
      wideSpanThreshold: null,
      preferGenderMix: false,
    });

    expect(result).toHaveLength(1);
    expect(new Set([...result[0].teamA, ...result[0].teamB]).size).toBe(4);
  });
});

describe('computeObjectiveTerms（0〜1に収まること）', () => {
  it('通常の入力ですべての項が0〜1に収まる', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const rankById = rankByIdFrom(ids);
    const priorityRankById = rankByIdFrom(ids);
    const genderById = new Map<string, 'M' | 'F' | undefined>(
      ids.map((id, i) => [id, i % 2 === 0 ? 'M' : 'F'] as const)
    );
    const courts: CourtPlacement[] = [
      { courtId: 1, teamA: ['p0', 'p1'], teamB: ['p2', 'p3'] },
      { courtId: 2, teamA: ['p4', 'p5'], teamB: ['p6', 'p7'] },
      { courtId: 3, teamA: ['p8', 'p9'], teamB: ['p10', 'p11'] },
    ];
    const pairCounts: PairCounts = {
      partner: new Map([[pairKey('p0', 'p1'), 20]]), // 極端な値でもクランプされる
      opponent: new Map([[pairKey('p2', 'p3'), 20]]),
    };

    const terms = computeObjectiveTerms({
      courts,
      benchIds: [],
      priorityRankById,
      candidateCount: ids.length,
      rankById,
      rosterSize: ids.length,
      genderById,
      preferGenderMix: false,
      pairCounts,
      pairKeyOf: pairKey,
      reachableCountById: new Map(ids.map(id => [id, ids.length - 1])),
      formRankById: rankById,
    });

    for (const [key, value] of Object.entries(terms)) {
      expect(value, `${key} は 0〜1 の範囲`).toBeGreaterThanOrEqual(0);
      expect(value, `${key} は 0〜1 の範囲`).toBeLessThanOrEqual(1);
    }
  });

  it('空コート・空控えでも0〜1に収まる（0除算しない）', () => {
    const terms = computeObjectiveTerms({
      courts: [],
      benchIds: [],
      priorityRankById: new Map(),
      candidateCount: 0,
      rankById: new Map(),
      rosterSize: 0,
      genderById: new Map(),
      preferGenderMix: false,
      pairCounts: emptyPairCounts(),
      pairKeyOf: pairKey,
      reachableCountById: new Map(),
      formRankById: new Map(),
    });

    for (const value of Object.values(terms)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('computeMixSplit', () => {
  const court = (
    teamA: [string, string],
    teamB: [string, string]
  ): CourtPlacement => ({ courtId: 1, teamA, teamB });

  /** m0/m1 が男性、f0/f1 が女性 */
  const genders = new Map<string, 'M' | 'F' | undefined>([
    ['m0', 'M'],
    ['m1', 'M'],
    ['f0', 'F'],
    ['f1', 'F'],
    ['x0', undefined],
  ]);

  it('2-2 を男男 vs 女女に分けたら 1.0', () => {
    expect(computeMixSplit([court(['m0', 'm1'], ['f0', 'f1'])], genders)).toBe(1);
    expect(computeMixSplit([court(['f0', 'f1'], ['m0', 'm1'])], genders)).toBe(1);
  });

  it('2-2 を MIX×MIX に分けたら 0', () => {
    expect(computeMixSplit([court(['m0', 'f0'], ['m1', 'f1'])], genders)).toBe(0);
    expect(computeMixSplit([court(['f0', 'm1'], ['m0', 'f1'])], genders)).toBe(0);
  });

  it('2-2 以外のコートは判定しない', () => {
    const fourMale = new Map<string, 'M' | 'F' | undefined>([
      ['m0', 'M'],
      ['m1', 'M'],
      ['m2', 'M'],
      ['m3', 'M'],
    ]);
    expect(computeMixSplit([court(['m0', 'm1'], ['m2', 'm3'])], fourMale)).toBe(0);

    const threeOne = new Map<string, 'M' | 'F' | undefined>([
      ['m0', 'M'],
      ['m1', 'M'],
      ['m2', 'M'],
      ['f0', 'F'],
    ]);
    expect(computeMixSplit([court(['m0', 'm1'], ['m2', 'f0'])], threeOne)).toBe(0);
  });

  it('性別未設定がいるコートは判定しない', () => {
    expect(computeMixSplit([court(['m0', 'm1'], ['f0', 'x0'])], genders)).toBe(0);
  });
});

describe('assignRoundByObjective の性別チーム分け', () => {
  it('2M2F のコートは男女戦（男男 vs 女女）にせず MIX×MIX に分ける', () => {
    // 実力順を M, F, F, M にすると competitive（順位和の差）は
    // 男男 vs 女女（0+3 vs 1+2 = 差0）を最良とし、MIX は最良でも差2。
    // mixSplit が無ければ男女戦が選ばれる配置。
    const candidates = [
      makePlayer('m0', { gender: 'M' }),
      makePlayer('f0', { gender: 'F' }),
      makePlayer('f1', { gender: 'F' }),
      makePlayer('m1', { gender: 'M' }),
    ];

    const result = assignRoundByObjective({
      candidates,
      courtIds: [1],
      rankById: rankByIdFrom(['m0', 'f0', 'f1', 'm1']),
      rosterSize: 4,
      priorityScoreOf,
      pairCounts: emptyPairCounts(),
      pairKeyOf: pairKey,
      isRecentDuplicate: () => false,
      wideSpanThreshold: null,
      preferGenderMix: false,
    });

    expect(result).toHaveLength(1);
    const genderOf = new Map(candidates.map(p => [p.id, p.gender]));
    const malesInA = result[0].teamA.filter(id => genderOf.get(id) === 'M').length;
    expect(malesInA).toBe(1); // 各チームが男女1人ずつ = MIX×MIX
  });
});

describe('公平性の窓（優先度順から離れすぎない）', () => {
  it('質を優先しても、優先度が大きく後ろの人は出場させない', () => {
    // 12人1コート。priorityScoreOf は id の数字（p0 が最優先）。
    // 必要人数 4 / 余剰 8 → 窓は 4 + ceil(8 * 0.7) = 10 番目まで。p10 以降は出せない。
    const candidates = Array.from({ length: 12 }, (_, i) => makePlayer(`p${i}`));

    // 実力順位を仕込む。優先度どおりの p0〜p3 だと p3 だけ実力が離れていて
    // skillGap も competitive も最悪。p10 を入れれば両方一気に解消する
    // （p4〜p9 は p3 と同格なので、窓の中の入れ替えでは解消できない）。
    const rankById = new Map<string, number>([
      ['p0', 0], ['p1', 1], ['p2', 2],
      ['p3', 11], ['p4', 11], ['p5', 11], ['p6', 11],
      ['p7', 11], ['p8', 11], ['p9', 11],
      ['p10', 3], ['p11', 12],
    ]);

    const result = assignRoundByObjective({
      candidates,
      courtIds: [1],
      rankById,
      rosterSize: 13,
      priorityScoreOf,
      pairCounts: emptyPairCounts(),
      pairKeyOf: pairKey,
      isRecentDuplicate: () => false,
      wideSpanThreshold: null,
      preferGenderMix: false,
    });

    const chosen = [...result[0].teamA, ...result[0].teamB].map(id =>
      Number(id.replace('p', ''))
    );
    // 窓が無ければ p10 が呼ばれる状況。窓があるので 10 番目以降は出せない。
    expect(Math.max(...chosen)).toBeLessThan(10);
  });

  it('候補が必要人数ちょうどなら窓は誰も弾かない', () => {
    const candidates = Array.from({ length: 8 }, (_, i) => makePlayer(`p${i}`));
    const result = assignRoundByObjective({
      candidates,
      courtIds: [1, 2],
      rankById: rankByIdFrom(candidates.map(p => p.id)),
      rosterSize: 8,
      priorityScoreOf,
      pairCounts: emptyPairCounts(),
      pairKeyOf: pairKey,
      isRecentDuplicate: () => false,
      wideSpanThreshold: null,
      preferGenderMix: false,
    });
    expect(result).toHaveLength(2);
    expect(new Set(result.flatMap(c => [...c.teamA, ...c.teamB])).size).toBe(8);
  });
});

describe('computeVariety の閾値スケール', () => {
  const courts: CourtPlacement[] = [
    { courtId: 1, teamA: ['a0', 'a1'], teamB: ['a2', 'a3'] },
  ];
  const counts = (n: number): PairCounts => {
    const partner = new Map<string, number>();
    const ids = ['a0', 'a1', 'a2', 'a3'];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) partner.set(pairKey(ids[i], ids[j]), n);
    }
    return { partner, opponent: new Map() };
  };

  it('組める相手が少ない人の共演回数は割り引いて評価する', () => {
    // 全員が同じ回数（2回）共演している状況。
    // 組める相手が平均並み（20人）なら満点のペナルティ、
    // 平均の半分（10人）しかいない人が混じるなら半分に割り引かれる。
    const average = new Map(['a0', 'a1', 'a2', 'a3'].map(id => [id, 20]));
    const narrow = new Map(average);
    narrow.set('a0', 10);

    const wide = computeVariety(courts, counts(2), pairKey, average);
    const narrowed = computeVariety(courts, counts(2), pairKey, narrow);

    expect(narrowed).toBeLessThan(wide);
  });

  it('全員の相手数が同じならスケールは掛からない', () => {
    const same = new Map(['a0', 'a1', 'a2', 'a3'].map(id => [id, 8]));
    const other = new Map(['a0', 'a1', 'a2', 'a3'].map(id => [id, 30]));
    expect(computeVariety(courts, counts(3), pairKey, same)).toBe(
      computeVariety(courts, counts(3), pairKey, other)
    );
  });
});

describe('後半均等化モード（公平性の窓を狭める）', () => {
  /** 16人・2コート。必要8人・余剰8人なので、通常は14位まで、後半均等化なら11位まで許可 */
  const setup = (lateBalanceMode: boolean) => {
    const candidates = Array.from({ length: 16 }, (_, i) =>
      makePlayer(`p${i}`, { gender: i % 2 === 0 ? 'M' : 'F', gamesPlayed: i })
    );
    // 実力順位を優先度順とずらし、質の最適化が窓の外の人を選びたくなるようにする
    const rankById = new Map(candidates.map((p, i) => [p.id, (i * 7) % 16]));
    return assignRoundByObjective({
      candidates,
      courtIds: [1, 2],
      rankById,
      rosterSize: 16,
      priorityScoreOf: p => p.gamesPlayed,
      pairCounts: emptyPairCounts(),
      pairKeyOf: pairKey,
      isRecentDuplicate: () => false,
      wideSpanThreshold: null,
      preferGenderMix: false,
      lateBalanceMode,
    });
  };
  const priorityOf = (result: ReturnType<typeof setup>) =>
    result.flatMap(c => [...c.teamA, ...c.teamB]).map(id => Number(id.slice(1)));

  it('通常は質のために優先度順を飛ばす（窓 0.7 = 14位まで）', () => {
    const picked = priorityOf(setup(false));
    expect(Math.max(...picked)).toBeGreaterThan(7); // 上位8人ちょうどではない
    expect(Math.max(...picked)).toBeLessThan(14); // ただし窓の外は選ばない
  });

  it('後半均等化 ON では窓が狭まり、優先度順に近づく（窓 0.3 = 11位まで）', () => {
    const picked = priorityOf(setup(true));
    expect(Math.max(...picked)).toBeLessThan(11);
  });

  it('ON のほうが選出が優先度順に近い', () => {
    expect(Math.max(...priorityOf(setup(true)))).toBeLessThan(
      Math.max(...priorityOf(setup(false)))
    );
  });
});
