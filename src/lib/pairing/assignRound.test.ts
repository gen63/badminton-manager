import { describe, it, expect } from 'vitest';
import { assignRoundByObjective } from './assignRound';
import {
  computeMixSplit,
  computeVariety,
  computeObjectiveTerms,
  computeAffinity,
  GENDER_BALANCE_OFF_WEIGHTS,
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
      affinityPairs: [],
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
      affinityPairs: [],
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

  it('男女比調整 OFF（GENDER_BALANCE_OFF_WEIGHTS）なら、実力が釣り合う男女戦を許容する', () => {
    // 上のテストと全く同じ入力。重みだけ差し替えると結論が反転することを見る
    // （= トグルが実際に配置を変えている / テストが空回りしていない）。
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
      weights: GENDER_BALANCE_OFF_WEIGHTS,
    });

    expect(result).toHaveLength(1);
    const genderOf = new Map(candidates.map(p => [p.id, p.gender]));
    const malesInA = result[0].teamA.filter(id => genderOf.get(id) === 'M').length;
    expect(malesInA).not.toBe(1); // 男男 vs 女女 = 順位和が完全に釣り合う組み合わせ
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

describe('順位差のハード制約: 登録序列とハシゴ式序列の両方で判定する', () => {
  // 16人1コート。狙いの4人（p0, p1, p14, p15）を優先度で先頭に固定し、
  // ハシゴ式序列でも隣同士にしておく。この4人が通るかどうかは
  // **登録序列の幅だけ**で決まる、という状況を作る。
  const target = ['p0', 'p1', 'p14', 'p15'];
  const ids = Array.from({ length: 16 }, (_, i) => `p${i}`);
  const candidates = ids.map(id => makePlayer(id));
  // 優先度: 狙いの4人が 0..3、残りは 10 以降
  const priority = (p: Player) => {
    const i = target.indexOf(p.id);
    return i >= 0 ? i : 10 + ids.indexOf(p.id);
  };
  // ハシゴ式後は狙いの4人が先頭に固まっている（＝当日の調子は近い）
  const formOrder = [...target, ...ids.filter(id => !target.includes(id))];

  const run = (rankById: Map<string, number>) =>
    assignRoundByObjective({
      candidates,
      courtIds: [1],
      rankById,
      formRankById: rankByIdFrom(formOrder),
      rosterSize: 16,
      priorityScoreOf: priority,
      pairCounts: emptyPairCounts(),
      pairKeyOf: pairKey,
      isRecentDuplicate: () => false,
      wideSpanThreshold: Math.ceil(16 * (2 / 3)), // 11
      preferGenderMix: false,
    });

  it('ハシゴ式序列で近くても、登録序列で幅が広すぎれば同居させない', () => {
    // 登録序列は id 順 → p0(0), p1(1), p14(14), p15(15) で幅15 ≥ 11 → 違反
    const regRank = rankByIdFrom(ids);
    const result = run(regRank);
    expect(result).toHaveLength(1);
    const picked = [...result[0].teamA, ...result[0].teamB];
    const span =
      Math.max(...picked.map(id => regRank.get(id)!)) -
      Math.min(...picked.map(id => regRank.get(id)!));
    expect(span).toBeLessThan(11);
    // 優先度どおりの4人がそのまま通ってはいない
    expect(new Set(picked)).not.toEqual(new Set(target));
  });

  it('登録序列でも近ければ、その4人がそのまま選ばれる（テストが空回りしていない）', () => {
    // formRank と同じ並びを登録序列にすると、狙いの4人は幅3 → 制約を通る
    const result = run(rankByIdFrom(formOrder));
    const picked = new Set([...result[0].teamA, ...result[0].teamB]);
    expect(picked).toEqual(new Set(target));
  });
});

describe('computeAffinity（objective.ts）', () => {
  const court = (
    courtId: number,
    teamA: [string, string],
    teamB: [string, string]
  ): CourtPlacement => ({ courtId, teamA, teamB });

  it('味方（同コートで partner）は寄与0', () => {
    const courts = [court(1, ['p0', 'p1'], ['p2', 'p3'])];
    const pairs = [{ a: 'p0', b: 'p1', deficit: 1 }];
    expect(computeAffinity(courts, [], pairs)).toBe(0);
  });

  it('同コートで敵なら寄与0.5', () => {
    const courts = [court(1, ['p0', 'p1'], ['p2', 'p3'])];
    const pairs = [{ a: 'p0', b: 'p2', deficit: 1 }];
    expect(computeAffinity(courts, [], pairs)).toBe(0.5);
  });

  it('別コートなら寄与1.0', () => {
    const courts = [
      court(1, ['p0', 'p1'], ['p2', 'p3']),
      court(2, ['p4', 'p5'], ['p6', 'p7']),
    ];
    const pairs = [{ a: 'p0', b: 'p4', deficit: 1 }];
    expect(computeAffinity(courts, [], pairs)).toBe(1.0);
  });

  it('片方以上がベンチなら寄与1.0', () => {
    const courts = [court(1, ['p0', 'p1'], ['p2', 'p3'])];
    const bench = ['p4'];
    const pairs = [{ a: 'p0', b: 'p4', deficit: 1 }];
    expect(computeAffinity(courts, bench, pairs)).toBe(1.0);
  });

  it('deficit の値でスケールする', () => {
    const courts = [court(1, ['p0', 'p1'], ['p2', 'p3'])];
    const pairs = [{ a: 'p0', b: 'p2', deficit: 0.4 }]; // 敵 → 寄与0.5 × deficit0.4
    expect(computeAffinity(courts, [], pairs)).toBeCloseTo(0.2);
  });

  it('評価対象ペア数で平均する（複数ペア）', () => {
    const courts = [
      court(1, ['p0', 'p1'], ['p2', 'p3']),
      court(2, ['p4', 'p5'], ['p6', 'p7']),
    ];
    const pairs = [
      { a: 'p0', b: 'p1', deficit: 1 }, // 味方 → 0
      { a: 'p0', b: 'p4', deficit: 1 }, // 別コート → 1.0
    ];
    expect(computeAffinity(courts, [], pairs)).toBeCloseTo(0.5);
  });

  it('対象ペアが0件なら0（未登録・両者ともプールに現れないペアも対象外）', () => {
    const courts = [court(1, ['p0', 'p1'], ['p2', 'p3'])];
    expect(computeAffinity(courts, [], [])).toBe(0);
    // 登録はされているが両者ともコート・ベンチのどちらにも現れないペア
    const pairs = [{ a: 'x0', b: 'x1', deficit: 1 }];
    expect(computeAffinity(courts, [], pairs)).toBe(0);
  });
});

describe('assignRoundByObjective: affinity（ペア希望・normal）', () => {
  it('回帰の担保: affinity の重みを0にすれば、希望ペアを登録しても配置は変わらない', () => {
    // 8人ちょうど・2コート。rankById が id の数字順そのままなので、
    // wideSpanThreshold なしの初期解は実力順に [p0-p3] / [p4-p7] へ素直に分かれる。
    const candidates = Array.from({ length: 8 }, (_, i) => makePlayer(`p${i}`));
    const rankById = rankByIdFrom(candidates.map(p => p.id));
    const baseParams = {
      candidates,
      courtIds: [1, 2],
      rankById,
      rosterSize: 8,
      priorityScoreOf,
      pairCounts: emptyPairCounts(),
      pairKeyOf: pairKey,
      isRecentDuplicate: () => false,
      wideSpanThreshold: null,
      preferGenderMix: false,
    };

    const baseline = assignRoundByObjective(baseParams);
    const withZeroWeight = assignRoundByObjective({
      ...baseParams,
      // 実力差の大きい p0-p7 を最大 deficit で登録しても、重み0なら効かないはず
      affinityPairs: [{ a: 'p0', b: 'p7', deficit: 1 }],
      weights: { affinity: 0 },
    });

    expect(withZeroWeight).toEqual(baseline);
  });

  it('比較用: 希望が無ければ p0 と p7 は別コートになる（下のテストが空回りしていないことの確認）', () => {
    const candidates = Array.from({ length: 8 }, (_, i) => makePlayer(`p${i}`));
    const rankById = rankByIdFrom(candidates.map(p => p.id));

    const result = assignRoundByObjective({
      candidates,
      courtIds: [1, 2],
      rankById,
      rosterSize: 8,
      priorityScoreOf,
      pairCounts: emptyPairCounts(),
      pairKeyOf: pairKey,
      isRecentDuplicate: () => false,
      wideSpanThreshold: null,
      preferGenderMix: false,
    });
    const courtOf = (id: string) =>
      result.find(c => [...c.teamA, ...c.teamB].includes(id))!;
    expect(courtOf('p0').courtId).not.toBe(courtOf('p7').courtId);
  });

  it('希望ペアが味方として配置される（実力差を押し切るだけの重みを与える）', () => {
    const candidates = Array.from({ length: 8 }, (_, i) => makePlayer(`p${i}`));
    const rankById = rankByIdFrom(candidates.map(p => p.id));

    const result = assignRoundByObjective({
      candidates,
      courtIds: [1, 2],
      rankById,
      rosterSize: 8,
      priorityScoreOf,
      pairCounts: emptyPairCounts(),
      pairKeyOf: pairKey,
      isRecentDuplicate: () => false,
      wideSpanThreshold: null,
      preferGenderMix: false,
      affinityPairs: [{ a: 'p0', b: 'p7', deficit: 1 }],
      weights: { affinity: 20 }, // skillGap 等を押し切れる大きさ
    });

    const courtOf = (id: string) =>
      result.find(c => [...c.teamA, ...c.teamB].includes(id))!;
    const courtP0 = courtOf('p0');
    const courtP7 = courtOf('p7');
    expect(courtP0.courtId).toBe(courtP7.courtId);
    const sameTeam =
      (courtP0.teamA.includes('p0') && courtP0.teamA.includes('p7')) ||
      (courtP0.teamB.includes('p0') && courtP0.teamB.includes('p7'));
    expect(sameTeam).toBe(true); // 同コートに集めるだけでなく味方になっている（splitCost 側の担保）
  });

  it('目標到達（deficit=0）なら効果が無く、他の目的（実力差）が優先される', () => {
    const candidates = Array.from({ length: 8 }, (_, i) => makePlayer(`p${i}`));
    const rankById = rankByIdFrom(candidates.map(p => p.id));

    const result = assignRoundByObjective({
      candidates,
      courtIds: [1, 2],
      rankById,
      rosterSize: 8,
      priorityScoreOf,
      pairCounts: emptyPairCounts(),
      pairKeyOf: pairKey,
      isRecentDuplicate: () => false,
      wideSpanThreshold: null,
      preferGenderMix: false,
      affinityPairs: [{ a: 'p0', b: 'p7', deficit: 0 }], // 目標達成済み
      weights: { affinity: 20 },
    });

    const courtOf = (id: string) =>
      result.find(c => [...c.teamA, ...c.teamB].includes(id))!;
    expect(courtOf('p0').courtId).not.toBe(courtOf('p7').courtId);
  });
});

describe('assignRoundByObjective: strong（ペア希望・強度「必ず」のハード制約）', () => {
  it('両方が出るなら必ず味方になる（候補=必要人数ちょうど・ベンチ0でも解が返る）', () => {
    // 8人ちょうど・2コート（ベンチ0）。この条件自体が「候補が必要人数ちょうど」の
    // 回帰テストを兼ねる。
    const candidates = Array.from({ length: 8 }, (_, i) => makePlayer(`p${i}`));
    const rankById = rankByIdFrom(candidates.map(p => p.id));

    const result = assignRoundByObjective({
      candidates,
      courtIds: [1, 2],
      rankById,
      rosterSize: 8,
      priorityScoreOf,
      pairCounts: emptyPairCounts(),
      pairKeyOf: pairKey,
      isRecentDuplicate: () => false,
      wideSpanThreshold: null,
      preferGenderMix: false,
      strongPairs: [{ a: 'p0', b: 'p7' }],
    });

    expect(result).toHaveLength(2);
    expect(new Set(result.flatMap(c => [...c.teamA, ...c.teamB])).size).toBe(8);

    const courtOf = (id: string) =>
      result.find(c => [...c.teamA, ...c.teamB].includes(id))!;
    const courtP0 = courtOf('p0');
    const courtP7 = courtOf('p7');
    expect(courtP0.courtId).toBe(courtP7.courtId);
    const sameTeam =
      (courtP0.teamA.includes('p0') && courtP0.teamA.includes('p7')) ||
      (courtP0.teamB.includes('p0') && courtP0.teamB.includes('p7'));
    expect(sameTeam).toBe(true);
  });

  it('片方だけの出場は許される（もう片方を無理にコートへ呼ばない）', () => {
    // 12人・2コート（必要8・余剰4）。窓（FAIRNESS_WINDOW_RATIO=0.7）は
    // 優先度順11番目まで許すが、優先度順どおりなら p0〜p7 が素直に選ばれ、
    // p11（最下位優先度）は通常どおりベンチに残る。
    const candidates = Array.from({ length: 12 }, (_, i) => makePlayer(`p${i}`));
    const rankById = rankByIdFrom(candidates.map(p => p.id));

    const result = assignRoundByObjective({
      candidates,
      courtIds: [1, 2],
      rankById,
      rosterSize: 12,
      priorityScoreOf,
      pairCounts: emptyPairCounts(),
      pairKeyOf: pairKey,
      isRecentDuplicate: () => false,
      wideSpanThreshold: null,
      preferGenderMix: false,
      strongPairs: [{ a: 'p0', b: 'p11' }],
    });

    const playing = new Set(result.flatMap(c => [...c.teamA, ...c.teamB]));
    expect(playing.has('p0')).toBe(true);
    expect(playing.has('p11')).toBe(false); // 片方だけの出場が許されている（違反にならない）
  });

  it('実力差が大きくても例外を投げず解が返る（詰まない）', () => {
    // 9人・2コート（必要8・余剰1）。p0-p8 の実力差（順位差8）は
    // wideSpanThreshold=5 と衝突するため、両方を同時に出場させて味方にすると
    // 必ず順位差の制約に違反する。ベンチが1人分あるので、どちらかを
    // ベンチへ回せば両方の制約を満たせる解が存在する。
    const candidates = Array.from({ length: 9 }, (_, i) => makePlayer(`p${i}`));
    const rankById = rankByIdFrom(candidates.map(p => p.id));
    const runParams = {
      candidates,
      courtIds: [1, 2],
      rankById,
      rosterSize: 9,
      priorityScoreOf,
      pairCounts: emptyPairCounts(),
      pairKeyOf: pairKey,
      isRecentDuplicate: () => false,
      wideSpanThreshold: 5,
      preferGenderMix: false,
      strongPairs: [{ a: 'p0', b: 'p8' }],
    };

    expect(() => assignRoundByObjective(runParams)).not.toThrow();

    const result = assignRoundByObjective(runParams);
    expect(result).toHaveLength(2);
    const allIds = result.flatMap(c => [...c.teamA, ...c.teamB]);
    expect(new Set(allIds).size).toBe(8); // 重複なく8人配置される（1人はベンチ）

    // 両者が同時に出場しているなら味方になっているはず（strong 制約は生きている）。
    // トレードオフで順位差制約に違反する可能性は plan 3d の想定どおり許容する。
    const playing = new Set(allIds);
    if (playing.has('p0') && playing.has('p8')) {
      const court = result.find(c => [...c.teamA, ...c.teamB].includes('p0'))!;
      const sameTeam =
        (court.teamA.includes('p0') && court.teamA.includes('p8')) ||
        (court.teamB.includes('p0') && court.teamB.includes('p8'));
      expect(sameTeam).toBe(true);
    }
  });
});
