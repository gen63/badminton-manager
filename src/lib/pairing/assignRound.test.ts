/**
 * 目的関数ベースの配置エンジン（`assignRound.ts`）のテスト。
 * 点数表は `objective.ts` の `SCORE_TABLE`（偏差何点分の悪さ）。設計は
 * docs/plans/2026-10-02-simplify-scoring.md。
 *
 * 点数表を書き換えるテストは `withTable` で必ず元に戻す。
 */
import { describe, it, expect } from 'vitest';
import { assignRoundByObjective, type AssignRoundParams } from './assignRound';
import { SCORE_TABLE, courtBreakdown, courtSpan, fairnessPoints, type ScoreContext } from './objective';
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

/** priorityScoreOf: id の数字部分をそのままスコアに使う（p0 が最優先。1差 = 1試合分） */
function priorityScoreOf(p: Player): number {
  return Number(p.id.replace(/\D/g, ''));
}

/** 並び順の先頭ほど偏差が高い（80, 77, 74, ...。3点刻み） */
function devByOrder(ids: string[], step = 3): Map<string, number> {
  return new Map(ids.map((id, i) => [id, 80 - step * i]));
}

/** SCORE_TABLE を一時的に書き換えて実行し、必ず戻す */
function withTable<T>(patch: Partial<typeof SCORE_TABLE>, fn: () => T): T {
  const saved = { ...SCORE_TABLE };
  Object.assign(SCORE_TABLE, patch);
  try {
    return fn();
  } finally {
    Object.assign(SCORE_TABLE, saved);
  }
}

type Params = Omit<AssignRoundParams, 'preferGenderMix' | 'priorityScoreOf'> &
  Partial<Pick<AssignRoundParams, 'preferGenderMix' | 'priorityScoreOf'>>;

const run = (params: Params) =>
  assignRoundByObjective({ preferGenderMix: false, priorityScoreOf, ...params });

const idsOf = (r: ReturnType<typeof run>) => new Set(r.flatMap(c => [...c.teamA, ...c.teamB]));
const courtOf = (r: ReturnType<typeof run>, id: string) =>
  r.find(c => [...c.teamA, ...c.teamB].includes(id))!;
const areTeammates = (r: ReturnType<typeof run>, a: string, b: string) => {
  const c = courtOf(r, a);
  return (c.teamA.includes(a) && c.teamA.includes(b)) || (c.teamB.includes(a) && c.teamB.includes(b));
};

describe('assignRoundByObjective', () => {
  it('4人×コート数が必ず配置される（重複なし）', () => {
    const candidates = Array.from({ length: 12 }, (_, i) => makePlayer(`p${i}`));
    const result = run({
      candidates,
      courtIds: [1, 2, 3],
      deviationById: devByOrder(candidates.map(p => p.id)),
    });
    expect(result).toHaveLength(3);
    const allIds = result.flatMap(c => [...c.teamA, ...c.teamB]);
    expect(new Set(allIds).size).toBe(12);
    expect(result.map(c => c.courtId).sort()).toEqual([1, 2, 3]);
  });

  it('候補が4人に満たなければ空（例外を投げない）', () => {
    const candidates = Array.from({ length: 3 }, (_, i) => makePlayer(`p${i}`));
    expect(run({ candidates, courtIds: [1], deviationById: devByOrder(['p0', 'p1', 'p2']) })).toEqual([]);
  });

  it('同じ入力で必ず同じ出力（決定性。1コート・複数コートとも）', () => {
    const candidates = Array.from({ length: 16 }, (_, i) =>
      makePlayer(`p${i}`, { gender: i % 3 === 0 ? 'F' : 'M' })
    );
    const deviationById = devByOrder(candidates.map(p => p.id), 2);
    const tripleWeights = new Map([['p0,p1,p2', 0.9]]);
    for (const courtIds of [[1], [1, 2, 3, 4]]) {
      const go = () => run({ candidates, courtIds, deviationById, tripleWeights });
      expect(go()).toEqual(go());
    }
  });

  it('極端な実力差のハード制約を満たす解があるとき、それが選ばれる（人数に関係なく適用）', () => {
    // 16人・4コート。偏差は 80〜35（3点刻み）。両端 p0 と p15 は 45 離れて極端。
    // 優先度順の素直な割り当てなら各コートの幅は小さく収まるが、極端な組があれば必ず外れる
    const candidates = Array.from({ length: 16 }, (_, i) => makePlayer(`p${i}`));
    const deviationById = devByOrder(candidates.map(p => p.id));
    const result = run({ candidates, courtIds: [1, 2, 3, 4], deviationById });
    for (const court of result) {
      expect(courtSpan([...court.teamA, ...court.teamB], deviationById)).toBeLessThan(SCORE_TABLE.extremeSpan);
    }
  });

  it('余りが十分ある（12人から1コート）なら極端な実力差は同居させない', () => {
    // p0=80 と p7=20 は 60 離れて極端。優先度は p0 と p7 を先頭にして同居を誘う
    // （余りが 4 以下の日は極端な実力差の効きが弱まる。下の「余りが少ない日」を参照）
    const candidates = Array.from({ length: 12 }, (_, i) => makePlayer(`p${i}`));
    const deviationById = new Map([
      ['p0', 80], ['p1', 55], ['p2', 54], ['p3', 53], ['p4', 52], ['p5', 51], ['p6', 50], ['p7', 20],
      ['p8', 52], ['p9', 51], ['p10', 50], ['p11', 49],
    ]);
    const result = run({
      candidates,
      courtIds: [1],
      deviationById,
      priorityScoreOf: p => (p.id === 'p0' || p.id === 'p7' ? 0 : 1),
    });
    const ids = idsOf(result);
    expect(ids.has('p0') && ids.has('p7')).toBe(false);
  });

  it('同じ顔ぶれの繰り返し（3人以上一致）はソフト: 他に同程度の解があれば入れ替わるが、強制はしない', () => {
    const candidates = Array.from({ length: 12 }, (_, i) => makePlayer(`p${i}`)); // 余り 8（公平性が強すぎない人数）
    const deviationById = devByOrder(candidates.map(p => p.id));
    // p0〜p3 の同じ4人が直前に出た（4つの3人組すべてが新しい）
    const tripleWeights = new Map(['p0,p1,p2', 'p0,p1,p3', 'p0,p2,p3', 'p1,p2,p3'].map(k => [k, 1] as const));
    const base = { candidates, courtIds: [1], deviationById };
    // 履歴なしなら優先度順の先頭 p0..p3
    expect([...idsOf(run(base))].sort()).toEqual(['p0', 'p1', 'p2', 'p3']);
    // 同じ4人の重みがあると、1人以上入れ替わる
    const withRepeat = idsOf(run({ ...base, tripleWeights }));
    expect(['p0', 'p1', 'p2', 'p3'].filter(id => withRepeat.has(id)).length).toBeLessThan(4);
    // 4人しか居なければ強制はせず同じ4人が出る（解が返る）
    const four = run({ ...base, candidates: candidates.slice(0, 4), tripleWeights });
    expect(idsOf(four).size).toBe(4);
  });

  it('余りが少ない日（8人から1コート）は、3人以上一致より試合数の公平性を優先する', () => {
    const candidates = Array.from({ length: 8 }, (_, i) => makePlayer(`p${i}`));
    const deviationById = devByOrder(candidates.map(p => p.id));
    // p0〜p3 が直前に出たことになっているが、先に出るべき（試合数が少ない）のは p0〜p3 のまま
    const tripleWeights = new Map(['p0,p1,p2', 'p0,p1,p3', 'p0,p2,p3', 'p1,p2,p3'].map(k => [k, 1] as const));
    const picked = idsOf(run({
      candidates, courtIds: [1], deviationById, tripleWeights,
      priorityScoreOf: p => (Number(p.id.slice(1)) < 4 ? 0 : 1),
    }));
    expect([...picked].sort()).toEqual(['p0', 'p1', 'p2', 'p3']);
  });

  it('余りが少ない日は極端な実力差より待たされている人を出し、余りが十分ある日は極端な実力差を避ける', () => {
    const build = (n: number) => {
      const candidates = Array.from({ length: n }, (_, i) => makePlayer(`p${i}`));
      const deviationById = new Map<string, number>(candidates.map(p => [p.id, 50] as const));
      deviationById.set('p0', 80);
      deviationById.set('p1', 20); // p0 と p1 は偏差差 60
      return {
        candidates, courtIds: [1], deviationById,
        priorityScoreOf: (p: Player) => (p.id === 'p0' || p.id === 'p1' ? 0 : 1),
      };
    };
    const small = idsOf(run(build(8))); // 余り 4
    expect(small.has('p0') && small.has('p1')).toBe(true);
    const large = idsOf(run(build(12))); // 余り 8
    expect(large.has('p0') && large.has('p1')).toBe(false);
  });

  it('解が存在しないとき例外を投げず、違反最小の解を返す', () => {
    // 4人しか居ないので全員を1コートに入れるしかない。極端な実力差の閾値を極端に小さくして必ず違反させる
    const candidates = Array.from({ length: 4 }, (_, i) => makePlayer(`p${i}`));
    const params = { candidates, courtIds: [1], deviationById: devByOrder(candidates.map(p => p.id)) };
    withTable({ extremeSpan: 1 }, () => {
      expect(() => run(params)).not.toThrow();
      const result = run(params);
      expect(result).toHaveLength(1);
      expect(idsOf(result).size).toBe(4);
    });
  });

  it('1コートは窓内の全組み合わせ×チーム分けの最小点と一致する（全列挙）', () => {
    // 乱数で偏差・性別を振った8人から1コート。ブルートフォースの最小点と、返った解の点が一致する
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let trial = 0; trial < 12; trial++) {
      const candidates = Array.from({ length: 8 }, (_, i) =>
        makePlayer(`p${i}`, { gender: rnd() < 0.5 ? 'F' : 'M' })
      );
      const deviationById = new Map(candidates.map(p => [p.id, 40 + Math.floor(rnd() * 28)] as const)); // 幅 < 30
      const need = new Map(candidates.map((p, i) => [p.id, Math.floor(i / 2)] as const));
      const genderById = new Map(candidates.map(p => [p.id, p.gender] as const));
      const ctx: ScoreContext = {
        deviationById, genderById, genderBalanceOn: true, preferGenderMix: false,
        tripleWeights: new Map(), streakById: new Map(), affinityPairs: [], needById: need,
      };
      const total = (four: string[], teams: [[string, string], [string, string]]) => {
        const bench = candidates.map(p => p.id).filter(id => !four.includes(id));
        return courtBreakdown(teams[0], teams[1], ctx).total + fairnessPoints(four, bench, need, false, 4);
      };
      const result = run({
        candidates, courtIds: [1], deviationById,
        priorityScoreOf: p => need.get(p.id)!,
      });
      const got = total(
        [...result[0].teamA, ...result[0].teamB],
        [result[0].teamA, result[0].teamB]
      );
      // 窓 = 4 + ceil(4 × 0.7) = 7 → 優先度順の先頭7人（p7 は出せない）
      const pool = candidates.slice(0, 7).map(p => p.id);
      let best = Infinity;
      for (let a = 0; a < pool.length; a++) for (let b = a + 1; b < pool.length; b++)
        for (let c = b + 1; c < pool.length; c++) for (let d = c + 1; d < pool.length; d++) {
          const four = [pool[a], pool[b], pool[c], pool[d]];
          const [w, x, y, z] = four;
          for (const teams of [[[w, x], [y, z]], [[w, y], [x, z]], [[w, z], [x, y]]] as [[string, string], [string, string]][]) {
            best = Math.min(best, total(four, teams));
          }
        }
      expect(got).toBeCloseTo(best, 6);
    }
  });

  it('候補22人・1コートの全列挙でも十分速い（次の試合の予測でも呼ばれる）', () => {
    const candidates = Array.from({ length: 22 }, (_, i) =>
      makePlayer(`p${i}`, { gender: i % 2 ? 'F' : 'M', gamesPlayed: i % 3 })
    );
    const deviationById = devByOrder(candidates.map(p => p.id), 2);
    const tripleWeights = new Map([['p0,p1,p2', 0.9], ['p3,p4,p5', 0.5]]);
    const start = performance.now();
    for (let i = 0; i < 5; i++) {
      run({ candidates, courtIds: [1], deviationById, tripleWeights, priorityScoreOf: p => p.gamesPlayed });
    }
    expect((performance.now() - start) / 5).toBeLessThan(500);
  });
});

describe('試合数の公平性（優先度の高い人を外さない・低い人を出さない）', () => {
  it('偏差が同じなら、試合数の少ない人から出る', () => {
    const candidates = Array.from({ length: 8 }, (_, i) => makePlayer(`p${i}`));
    const deviationById = new Map<string, number>(candidates.map(p => [p.id, 50] as const));
    const picked = idsOf(run({ candidates, courtIds: [1], deviationById, priorityScoreOf: p => (p.id < 'p4' ? 1 : 0) }));
    expect([...picked].sort()).toEqual(['p4', 'p5', 'p6', 'p7']);
  });

  it('レート差が小さい範囲では、試合数が1試合分多いだけの人より少ない人を優先する', () => {
    // p3 は試合数が1多い。偏差が3点違う p4 と入れ替えるほうが、逆転1組(15点)より得（幅の悪化が小さい）
    const candidates = Array.from({ length: 5 }, (_, i) => makePlayer(`p${i}`));
    const deviationById = new Map([['p0', 60], ['p1', 59], ['p2', 58], ['p3', 57], ['p4', 56]]);
    const picked = idsOf(run({
      candidates, courtIds: [1], deviationById,
      priorityScoreOf: p => (p.id === 'p3' ? 1 : 0),
    }));
    expect(picked.has('p4')).toBe(true);
    expect(picked.has('p3')).toBe(false);
  });
});

describe('公平性の窓（優先度順から離れすぎない）', () => {
  it('質を優先しても、優先度が大きく後ろの人は出場させない', () => {
    // 12人1コート。必要4 / 余剰8 → 窓は 4 + ceil(8 × 0.7) = 10 番目まで。p10 以降は出せない。
    // p0〜p2 と同格の p10 を入れれば質は一気に解消する（p3〜p9 は幅25の離れた層）。
    // ソフトの公平性を切って、窓というハード制約だけの効きを見る
    const candidates = Array.from({ length: 12 }, (_, i) => makePlayer(`p${i}`));
    const deviationById = new Map<string, number>([
      ['p0', 80], ['p1', 78], ['p2', 76],
      ...['p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'].map(id => [id, 55] as const),
      ['p10', 77], ['p11', 40],
    ]);
    const result = withTable({ fairnessPerGame: 0 }, () => run({ candidates, courtIds: [1], deviationById }));
    const chosen = [...idsOf(result)].map(id => Number(id.slice(1)));
    expect(Math.max(...chosen)).toBeLessThan(10); // 窓が無ければ p10 が呼ばれる状況
  });

  it('複数コートでも窓の外の人は出さない（局所探索のハード制約）', () => {
    // 12人2コート: 必要8・余剰4 → 窓 8 + ceil(2.8) = 11 番目まで。p11 は出せない
    const candidates = Array.from({ length: 12 }, (_, i) => makePlayer(`p${i}`));
    // p11 を最上位の偏差にして、質の最適化が p11 を呼びたくなるようにする
    const deviationById = new Map(candidates.map(p => [p.id, p.id === 'p11' ? 80 : 60 - Number(p.id.slice(1))] as const));
    const result = withTable({ fairnessPerGame: 0 }, () => run({ candidates, courtIds: [1, 2], deviationById }));
    expect(idsOf(result).has('p11')).toBe(false);
  });

  it('候補が必要人数ちょうどなら窓は誰も弾かない', () => {
    const candidates = Array.from({ length: 8 }, (_, i) => makePlayer(`p${i}`));
    const result = run({ candidates, courtIds: [1, 2], deviationById: devByOrder(candidates.map(p => p.id)) });
    expect(result).toHaveLength(2);
    expect(idsOf(result).size).toBe(8);
  });
});

describe('後半均等化モード（公平性の窓を狭める・点数を強める）', () => {
  /** 16人・2コート。必要8人・余剰8人なので、通常は14位まで、後半均等化なら11位まで許可 */
  const setup = (lateBalanceMode: boolean) => {
    const candidates = Array.from({ length: 16 }, (_, i) =>
      makePlayer(`p${i}`, { gender: i % 2 === 0 ? 'M' : 'F', gamesPlayed: i })
    );
    // 偏差を優先度順とずらし、質の最適化が窓の外の人を選びたくなるようにする
    const deviationById = new Map(candidates.map((p, i) => [p.id, 80 - ((i * 7) % 16) * 2] as const));
    return run({
      candidates,
      courtIds: [1, 2],
      deviationById,
      priorityScoreOf: p => p.gamesPlayed,
      lateBalanceMode,
    });
  };
  const priorityOf = (result: ReturnType<typeof setup>) => [...idsOf(result)].map(id => Number(id.slice(1)));

  it('窓の仕組み: 通常は 0.7（14位まで）、ON は 0.3（11位まで）', () => {
    withTable({ fairnessPerGame: 0 }, () => {
      const normal = priorityOf(setup(false));
      expect(Math.max(...normal)).toBeGreaterThan(7); // 上位8人ちょうどではない
      expect(Math.max(...normal)).toBeLessThan(14); // ただし窓の外は選ばない
      expect(Math.max(...priorityOf(setup(true)))).toBeLessThan(11);
    });
  });

  it('ON のほうが選出が優先度順に近い（点数も込みの既定でも）', () => {
    const sum = (r: ReturnType<typeof setup>) => priorityOf(r).reduce((a, b) => a + b, 0);
    expect(sum(setup(true))).toBeLessThanOrEqual(sum(setup(false)));
    expect(Math.max(...priorityOf(setup(true)))).toBeLessThan(11);
  });
});

describe('極端な実力差のハード制約（偏差で判定）', () => {
  // 16人1コート。狙いの4人（p0, p1, p14, p15）を優先度で先頭に固定する
  const target = ['p0', 'p1', 'p14', 'p15'];
  const ids = Array.from({ length: 16 }, (_, i) => `p${i}`);
  const candidates = ids.map(id => makePlayer(id));
  const priority = (p: Player) => {
    const i = target.indexOf(p.id);
    return i >= 0 ? i : 10 + ids.indexOf(p.id);
  };

  it('偏差が極端に離れた4人は、優先度が先頭でも同居させない', () => {
    const deviationById = devByOrder(ids); // p0=80 ... p15=35 → p0〜p15 は 45 差
    const result = run({ candidates, courtIds: [1], deviationById, priorityScoreOf: priority });
    const picked = [...idsOf(result)];
    expect(courtSpan(picked, deviationById)).toBeLessThan(SCORE_TABLE.extremeSpan);
    expect(new Set(picked)).not.toEqual(new Set(target));
  });

  it('偏差が近ければ、その4人がそのまま選ばれる（テストが空回りしていない）', () => {
    const deviationById = new Map(ids.map(id => [id, target.includes(id) ? 60 + target.indexOf(id) : 40] as const));
    const result = run({ candidates, courtIds: [1], deviationById, priorityScoreOf: priority });
    expect(idsOf(result)).toEqual(new Set(target));
  });
});

describe('コート内の最大−最小（凸の点数）: 小人数でも大きく離れた組を避ける', () => {
  // 12人・1コート。優先度は p0 と p11（両端）が最優先、p5・p6 が次点。
  // 点数が線形・小さいと両端 p0×p11 が同じコートに入るが、既定の点数表（knee 超えの上乗せ）は避ける
  const candidates = Array.from({ length: 12 }, (_, i) => makePlayer(`p${i}`));
  const deviationById = devByOrder(candidates.map(p => p.id), 2.5); // p0=80 ... p11=52.5（幅27.5: 極端（30）未満）
  const go = () =>
    run({
      candidates,
      courtIds: [1],
      deviationById,
      priorityScoreOf: p => (p.id === 'p0' || p.id === 'p11' ? 0 : p.id === 'p5' || p.id === 'p6' ? 0.5 : 1),
    });

  it('幅の点数を切ると両端が同居する（効果を確かめる対照）', () => {
    const ids = withTable({ courtSpan: 0, courtSpanExcess: 0, courtSpanExcessMax: 0 }, () => idsOf(go()));
    expect(ids.has('p0') && ids.has('p11')).toBe(true);
  });

  it('既定の点数表では、両端（偏差差27.5）の同居を避ける', () => {
    const ids = idsOf(go());
    expect(ids.has('p0') && ids.has('p11')).toBe(false);
  });
});

describe('男女バランスとチーム分け', () => {
  // 偏差: m0=62, f0=54, f1=46, m1=38。男男 vs 女女は完全に釣り合う（差0）が、
  // MIX×MIX の最良も差16（平均差8 = 16点）に収まる
  const candidates = [
    makePlayer('m0', { gender: 'M' }),
    makePlayer('f0', { gender: 'F' }),
    makePlayer('f1', { gender: 'F' }),
    makePlayer('m1', { gender: 'M' }),
  ];
  const deviationById = new Map([['m0', 62], ['f0', 54], ['f1', 46], ['m1', 38]]);
  const malesInA = (r: ReturnType<typeof run>) =>
    r[0].teamA.filter(id => candidates.find(p => p.id === id)!.gender === 'M').length;

  it('2M2F のコートは男女戦（男男 vs 女女）にせず MIX×MIX に分ける（男女比調整 ON）', () => {
    const result = run({ candidates, courtIds: [1], deviationById });
    expect(malesInA(result)).toBe(1);
  });

  it('男女比調整 OFF なら、実力が釣り合う男女戦を許容する（点数が小さいので釣り合いが勝つ）', () => {
    const result = run({ candidates, courtIds: [1], deviationById, genderBalanceMode: false });
    expect(malesInA(result)).not.toBe(1);
  });

  it('3-1 が避けられるなら 2-2 / 4-0 を選ぶ（偏差が同じ6人から4人）', () => {
    const six = [
      ...['a', 'b', 'c', 'd'].map(id => makePlayer(id, { gender: 'M' as const })),
      ...['e', 'f'].map(id => makePlayer(id, { gender: 'F' as const })),
    ];
    const result = run({
      candidates: six,
      courtIds: [1],
      deviationById: new Map(six.map(p => [p.id, 50] as const)),
      priorityScoreOf: () => 0,
    });
    const females = [...idsOf(result)].filter(id => six.find(p => p.id === id)!.gender === 'F').length;
    expect([0, 2, 4]).toContain(females); // 1人・3人（3-1）にはならない
  });
});

describe('ペア希望（normal）', () => {
  const eight = Array.from({ length: 8 }, (_, i) => makePlayer(`p${i}`));
  const eightDev = devByOrder(eight.map(p => p.id));

  it('回帰の担保: pairPref を0にすれば、希望ペアを登録しても配置は変わらない', () => {
    const base = { candidates: eight, courtIds: [1, 2], deviationById: eightDev };
    const baseline = run(base);
    const zero = withTable({ pairPref: 0 }, () => run({ ...base, affinityPairs: [{ a: 'p0', b: 'p7' }] }));
    expect(zero).toEqual(baseline);
  });

  it('比較用: 希望が無ければ p0 と p7 は別コートになる（下のテストが空回りしていないことの確認）', () => {
    const result = run({ candidates: eight, courtIds: [1, 2], deviationById: eightDev });
    expect(courtOf(result, 'p0').courtId).not.toBe(courtOf(result, 'p7').courtId);
  });

  it('希望ペアが味方として配置される（実力差を押し切るだけの点を与える）', () => {
    const result = withTable({ pairPref: 300 }, () =>
      run({ candidates: eight, courtIds: [1, 2], deviationById: eightDev, affinityPairs: [{ a: 'p0', b: 'p7' }] })
    );
    expect(courtOf(result, 'p0').courtId).toBe(courtOf(result, 'p7').courtId);
    expect(areTeammates(result, 'p0', 'p7')).toBe(true); // 同コートに集めるだけでなく味方になっている
  });

  it('既定の点数でも、同じコートに入った希望ペアは敵にならない（隣り合う実力）', () => {
    const result = run({ candidates: eight, courtIds: [1, 2], deviationById: eightDev, affinityPairs: [{ a: 'p0', b: 'p1' }] });
    expect(courtOf(result, 'p0').courtId).toBe(courtOf(result, 'p1').courtId);
    expect(areTeammates(result, 'p0', 'p1')).toBe(true);
  });

  // 実運用バグ（2026-09-17）の系統: 同性の希望ペアが 2-2 コートで敵にされる。
  // 2026-09-19 の運用者判断: 「希望ペアが登録されているコートに限り男女戦を許容する」。
  const worst = [
    makePlayer('p0', { gender: 'M' }), // 希望ペア（両端の実力: p0 と p3）
    makePlayer('p1', { gender: 'F' }),
    makePlayer('p2', { gender: 'F' }),
    makePlayer('p3', { gender: 'M' }),
    makePlayer('p4', { gender: 'M' }),
    makePlayer('p5', { gender: 'F' }),
    makePlayer('p6', { gender: 'M' }),
    makePlayer('p7', { gender: 'F' }),
  ];
  const worstDev = devByOrder(worst.map(p => p.id));
  const genderOf = (id: string) => worst.find(p => p.id === id)!.gender;
  const isMixSplit = (c: { teamA: string[]; teamB: string[] }) => {
    const ids = [...c.teamA, ...c.teamB];
    const gs = ids.map(genderOf);
    if (gs.filter(g => g === 'M').length !== 2) return false;
    const m = c.teamA.filter(id => genderOf(id) === 'M').length;
    return m === 0 || m === 2;
  };

  it('同性の希望ペア（両端の実力・逃げ道が無い8人）は2-2コートで味方になる（男女戦を許容）', () => {
    const result = run({ candidates: worst, courtIds: [1, 2], deviationById: worstDev, affinityPairs: [{ a: 'p0', b: 'p3' }] });
    expect(courtOf(result, 'p0').courtId).toBe(courtOf(result, 'p3').courtId);
    expect(areTeammates(result, 'p0', 'p3')).toBe(true);
    expect(isMixSplit(courtOf(result, 'p0'))).toBe(true); // 男女戦（男男 vs 女女）
  });

  it('希望ペアを含まないコートでは男女戦にしない', () => {
    const result = run({ candidates: worst, courtIds: [1, 2], deviationById: worstDev });
    for (const court of result) expect(isMixSplit(court)).toBe(false);
  });

  it('複数コートで希望ペアを登録しても、それを含まないコートは男女戦にしない（無関係コートへの波及なし）', () => {
    const extra = worst.map(p => makePlayer(p.id.replace('p', 'q'), { gender: p.gender }));
    const candidates = [...worst, ...extra];
    const deviationById = devByOrder(candidates.map(p => p.id), 2);
    const result = run({ candidates, courtIds: [1, 2, 3, 4], deviationById, affinityPairs: [{ a: 'p0', b: 'p3' }] });
    const pairCourt = courtOf(result, 'p0').courtId;
    const g = (id: string) => candidates.find(p => p.id === id)!.gender;
    for (const court of result) {
      if (court.courtId === pairCourt) continue;
      const gs = [...court.teamA, ...court.teamB].map(g);
      if (gs.filter(x => x === 'M').length === 2) {
        expect(court.teamA.filter(id => g(id) === 'M').length).toBe(1);
      }
    }
  });

  it('比較用: 異性の希望ペアは男女戦と衝突しないので味方になる', () => {
    const result = run({ candidates: worst, courtIds: [1, 2], deviationById: worstDev, affinityPairs: [{ a: 'p0', b: 'p1' }] });
    expect(courtOf(result, 'p0').courtId).toBe(courtOf(result, 'p1').courtId);
    expect(areTeammates(result, 'p0', 'p1')).toBe(true);
  });

  it('性別未設定でも、実力が隣接する希望ペアは味方になる（チームの釣り合いに負けない）', () => {
    // 希望ペアが下位2人 (p6,p7) だと [a,b]|[c,d] で釣り合いが最も崩れる並び
    const result = run({ candidates: eight, courtIds: [1, 2], deviationById: eightDev, affinityPairs: [{ a: 'p6', b: 'p7' }] });
    expect(courtOf(result, 'p6').courtId).toBe(courtOf(result, 'p7').courtId);
    expect(areTeammates(result, 'p6', 'p7')).toBe(true);
  });
});

describe('ペア希望「必ず」（strong）のハード制約', () => {
  const eight = Array.from({ length: 8 }, (_, i) => makePlayer(`p${i}`));
  const twelve = Array.from({ length: 12 }, (_, i) => makePlayer(`p${i}`));

  it('回帰: 男女戦と衝突する同性ペアでも strong なら必ず味方になる', () => {
    const candidates = [
      makePlayer('p0', { gender: 'M' }), makePlayer('p1', { gender: 'F' }),
      makePlayer('p2', { gender: 'F' }), makePlayer('p3', { gender: 'M' }),
      makePlayer('p4', { gender: 'M' }), makePlayer('p5', { gender: 'F' }),
      makePlayer('p6', { gender: 'M' }), makePlayer('p7', { gender: 'F' }),
    ];
    // 実運用の配線どおり affinityPairs と strongPairs の両方に載せる。ハードは点数より先に評価される
    const result = withTable({ pairPref: 0 }, () =>
      run({
        candidates, courtIds: [1, 2], deviationById: devByOrder(candidates.map(p => p.id)),
        affinityPairs: [{ a: 'p0', b: 'p3' }], strongPairs: [{ a: 'p0', b: 'p3' }],
      })
    );
    expect(courtOf(result, 'p0').courtId).toBe(courtOf(result, 'p3').courtId);
    expect(areTeammates(result, 'p0', 'p3')).toBe(true);
  });

  it('両方が出るなら必ず味方になる（候補=必要人数ちょうど・ベンチ0でも解が返る）', () => {
    const result = run({
      candidates: eight, courtIds: [1, 2], deviationById: devByOrder(eight.map(p => p.id)),
      strongPairs: [{ a: 'p0', b: 'p7' }],
    });
    expect(result).toHaveLength(2);
    expect(idsOf(result).size).toBe(8);
    expect(courtOf(result, 'p0').courtId).toBe(courtOf(result, 'p7').courtId);
    expect(areTeammates(result, 'p0', 'p7')).toBe(true);
  });

  it('片方の順番だけ来ているとき、窓の内側なら引っ張り込んで2人そろって出場する', () => {
    // 12人・2コート（必要8・余剰4）。窓は 8 + ceil(4×0.7) = 11 番目まで。p9 は窓の内側
    const result = run({
      candidates: twelve, courtIds: [1, 2], deviationById: devByOrder(twelve.map(p => p.id), 2),
      strongPairs: [{ a: 'p0', b: 'p9' }],
    });
    expect(result).toHaveLength(2);
    expect(idsOf(result).has('p0') && idsOf(result).has('p9')).toBe(true);
    expect(courtOf(result, 'p0').courtId).toBe(courtOf(result, 'p9').courtId);
    expect(areTeammates(result, 'p0', 'p9')).toBe(true);
  });

  it('相手が公平性の窓の外なら2人とも控えになる（解が返り、コートは埋まる）', () => {
    const result = run({
      candidates: twelve, courtIds: [1, 2], deviationById: devByOrder(twelve.map(p => p.id), 2),
      strongPairs: [{ a: 'p0', b: 'p11' }],
    });
    expect(result).toHaveLength(2);
    expect(idsOf(result).size).toBe(8);
    expect(idsOf(result).has('p0')).toBe(false);
    expect(idsOf(result).has('p11')).toBe(false);
  });

  it('1コート（全列挙）でも (b) 2人一緒に出るか2人とも控えるかを守る', () => {
    const result = run({
      candidates: twelve, courtIds: [1], deviationById: devByOrder(twelve.map(p => p.id), 2),
      strongPairs: [{ a: 'p0', b: 'p3' }],
    });
    const ids = idsOf(result);
    expect(ids.has('p0')).toBe(ids.has('p3'));
    if (ids.has('p0')) expect(areTeammates(result, 'p0', 'p3')).toBe(true);
  });

  it('実力差が大きくても例外を投げず解が返る（詰まない）', () => {
    // 9人・2コート（必要8・余剰1）。p0-p8 は 24 離れる。極端の閾値を 15 に下げ、
    // 両方を同時に出して味方にすると他の2人が必ず違反する状況でも詰まらないこと
    const candidates = Array.from({ length: 9 }, (_, i) => makePlayer(`p${i}`));
    const params = {
      candidates, courtIds: [1, 2], deviationById: devByOrder(candidates.map(p => p.id)),
      strongPairs: [{ a: 'p0', b: 'p8' }],
    };
    withTable({ extremeSpan: 15 }, () => {
      expect(() => run(params)).not.toThrow();
      const result = run(params);
      expect(result).toHaveLength(2);
      expect(idsOf(result).size).toBe(8);
      if (idsOf(result).has('p0') && idsOf(result).has('p8')) expect(areTeammates(result, 'p0', 'p8')).toBe(true);
    });
  });
});

describe('ペア「必ず」の2人の間の差は、極端な実力差の判定から除外する', () => {
  // 回帰: 上位と下位を「必ず」にすると、同コートに置くと極端な実力差違反、別々に出すと strong 違反で、
  // 違反数の比較では別々に出す方が勝ち、strong が破られていた。
  // docs/plans/2026-10-01-strong-pair-rank-span.md
  const ids = Array.from({ length: 20 }, (_, i) => `p${i}`);
  const candidates = ids.map(id => makePlayer(id));
  const deviationById = devByOrder(ids); // p0=80 ... p19=23

  const simulate = (threshold: number, strongPairs: { a: string; b: string }[], rounds: number) =>
    withTable({ extremeSpan: threshold }, () => {
      const plays = new Map(ids.map(id => [id, 0]));
      let together = 0;
      let onlyOne = 0;
      let allTeammates = true;
      let othersWithinSpan = true;
      for (let r = 0; r < rounds; r++) {
        const result = run({
          candidates, courtIds: [1, 2, 3], deviationById,
          priorityScoreOf: p => plays.get(p.id)! * 100 + Number(p.id.slice(1)),
          strongPairs,
        });
        for (const id of idsOf(result)) plays.set(id, plays.get(id)! + 1);
        for (const { a, b } of strongPairs) {
          const courtA = result.find(c => [...c.teamA, ...c.teamB].includes(a));
          const courtB = result.find(c => [...c.teamA, ...c.teamB].includes(b));
          if (!courtA !== !courtB) onlyOne++;
          if (courtA && courtB) {
            together++;
            if (courtA !== courtB || !areTeammates(result, a, b)) allTeammates = false;
            // ペア以外の2人は、ペアの両方との差が閾値未満でなければならない
            for (const id of [...courtA.teamA, ...courtA.teamB]) {
              if (id === a || id === b) continue;
              if (
                Math.abs(deviationById.get(id)! - deviationById.get(a)!) >= threshold ||
                Math.abs(deviationById.get(id)! - deviationById.get(b)!) >= threshold
              ) othersWithinSpan = false;
            }
          }
        }
      }
      return { together, onlyOne, allTeammates, othersWithinSpan };
    });

  // ペア2人の差が閾値以上でも「ペア以外の2人が両方と閾値未満」になれる組を使う
  // （p0×p19 のように構造上その2人が取れない組は、除外しても違反が残るため対象外）
  const cases = [
    { threshold: 30, pair: { a: 'p0', b: 'p10' } }, // 差30
    { threshold: 35, pair: { a: 'p0', b: 'p12' } }, // 差36（既定の 30 とは別の閾値でも成り立つ）
  ];
  for (const { threshold, pair } of cases) {
    it(`strong=[${pair.a},${pair.b}] は閾値${threshold}でも片方だけ出場せず、出場時は必ず味方`, () => {
      const r = simulate(threshold, [pair], 40);
      expect(r.onlyOne).toBe(0);
      expect(r.together).toBeGreaterThan(0); // 空回り防止: 実際に出場している
      expect(r.allTeammates).toBe(true);
    });

    it(`閾値${threshold}: 除外されるのはペア2人の間の差だけで、ペアと他メンバーの差は違反のまま`, () => {
      const r = simulate(threshold, [pair], 40);
      expect(r.together).toBeGreaterThan(0);
      expect(r.othersWithinSpan).toBe(true);
    });
  }
});

describe('連続出場（2/3/4連続目の点）', () => {
  // 5人・1コート（4人必要）。全員 priority 同点・偏差も同じなので、どの4人でも点は同じ。
  // 連続の点が無ければ同点は優先度順の先頭に倒れ、p0〜p3 が選ばれる。
  // p3 だけが「たった今終わったコートに居た（連続候補）」状態を作る
  const candidates = Array.from({ length: 5 }, (_, i) => makePlayer(`p${i}`));
  const deviationById = new Map(candidates.map(p => [p.id, 70] as const));
  const base = { candidates, courtIds: [1], deviationById, priorityScoreOf: () => 0 };

  it('比較用: streak を渡さなければ p3 が選ばれる（下のテストが空回りしていない確認）', () => {
    const picked = idsOf(run(base));
    expect(picked.has('p3')).toBe(true);
    expect(picked.has('p4')).toBe(false);
  });

  it('2連続目（streak=1）でも、他が同条件なら休んでいる人に道を譲る', () => {
    const picked = idsOf(run({ ...base, streakById: new Map([['p3', 1]]) }));
    expect(picked.has('p4')).toBe(true);
    expect(picked.has('p3')).toBe(false);
  });

  it('2連続目の点は軽い: 試合数が1試合分多い（p4）ほうの逆転のほうが重ければ p3 が出る', () => {
    const picked = idsOf(run({
      ...base,
      priorityScoreOf: (p: Player) => (p.id === 'p4' ? 1 : 0),
      streakById: new Map([['p3', 1]]),
    }));
    expect(picked.has('p3')).toBe(true);
    expect(picked.has('p4')).toBe(false);
  });

  it('3連続目（streak=2）は避ける', () => {
    const picked = idsOf(run({ ...base, streakById: new Map([['p3', 2]]) }));
    expect(picked.has('p4')).toBe(true);
    expect(picked.has('p3')).toBe(false);
  });

  it('3連続目はハードではない: 極端な実力差のハード制約を破ってまでは避けない', () => {
    // p4 を入れると p0 との差が 40 で極端（30 以上）。3連続目の p3 を出さざるを得ない
    const picked = idsOf(run({
      ...base,
      deviationById: new Map([['p0', 70], ['p1', 70], ['p2', 70], ['p3', 70], ['p4', 30]]),
      streakById: new Map([['p3', 2]]),
    }));
    expect(picked.has('p3')).toBe(true);
    expect(picked.has('p4')).toBe(false);
  });

  it('4連続目以上は、試合数が1試合分多い人を出す逆転があっても強く避ける', () => {
    // 10人（余り 6）: p0〜p3 が先に出るべき（p4 以降は1試合分多い）。p3 が4連続目になる
    const ten = Array.from({ length: 10 }, (_, i) => makePlayer(`p${i}`));
    const picked = idsOf(run({
      candidates: ten,
      courtIds: [1],
      deviationById: new Map(ten.map(p => [p.id, 70] as const)),
      priorityScoreOf: (p: Player) => (Number(p.id.slice(1)) >= 4 ? 1 : 0),
      streakById: new Map([['p3', 3]]), // 今回4連続目
    }));
    expect(picked.has('p3')).toBe(false);
  });

  it('段階的: 2連続目の人と3連続目の人のどちらかを控えにするなら、3連続目の人を控える', () => {
    const picked = idsOf(run({
      ...base,
      streakById: new Map([['p2', 2], ['p3', 1]]),
    }));
    expect(picked.has('p3')).toBe(true);
    expect(picked.has('p2')).toBe(false);
  });

  it('避けられないとき（控えが居ない）は配置を諦めず、連続の人も出す', () => {
    const four = candidates.slice(0, 4);
    const result = run({ ...base, candidates: four, streakById: new Map(four.map(p => [p.id, 3] as const)) });
    expect(idsOf(result).size).toBe(4);
  });

  it('連続の点を0にすれば、連続の項は無効化できる', () => {
    const baseline = run(base);
    const zero = withTable({ streak: [0, 0, 0] }, () => run({ ...base, streakById: new Map([['p3', 3]]) }));
    expect(zero).toEqual(baseline);
  });

  it('streakById を省略すればこの項は無効', () => {
    expect(run({ ...base, streakById: undefined })).toEqual(run(base));
  });
});
