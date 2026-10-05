import { describe, it, expect } from 'vitest';
import {
  computePerformanceRatings,
  findPerformance,
  reassignDisplayRanks,
  BASE_RATING,
  judgeMatch,
  judgeMatchNeutral,
  estimateStrengthsById,
  getPlayerMatchInsight,
  countVerdicts,
} from './performanceRating';
import type { Match } from '../types/match';
import type { Player } from '../types/player';
import type { PlayerPerformance } from './performanceRating';

const makePlayer = (name: string): Player => ({
  id: `id-${name}`,
  name,
  isResting: false,
  gamesPlayed: 0,
  lastPlayedAt: 0,
  activatedAt: 0,
});

let matchSeq = 0;
/** 勝敗確定済みの試合を作る。teamA/teamB は名前で指定（1人ならシングルス）。 */
const match = (
  teamA: string[],
  teamB: string[],
  winner: 'A' | 'B'
): Match => ({
  id: `m${++matchSeq}`,
  courtId: 1,
  teamA: [`id-${teamA[0]}`, teamA[1] ? `id-${teamA[1]}` : ''],
  teamB: [`id-${teamB[0]}`, teamB[1] ? `id-${teamB[1]}` : ''],
  scoreA: winner === 'A' ? 21 : 15,
  scoreB: winner === 'B' ? 21 : 15,
  startedAt: 0,
  finishedAt: 0,
  winner,
});

const unscored = (teamA: string[], teamB: string[]): Match => ({
  ...match(teamA, teamB, 'A'),
  scoreA: 0,
  scoreB: 0,
  winner: undefined,
});

const playersOf = (...names: string[]) => names.map(makePlayer);
const ratingOf = (result: ReturnType<typeof computePerformanceRatings>, name: string) =>
  findPerformance(result, name)!.rating;

describe('computePerformanceRatings', () => {
  it('試合が無ければ空の結果', () => {
    const result = computePerformanceRatings([], playersOf('A', 'B'));
    expect(result.players).toEqual([]);
    expect(result.ratedMatchCount).toBe(0);
  });

  it('結果未入力の試合は集計対象外', () => {
    const players = playersOf('A', 'B', 'C', 'D');
    const result = computePerformanceRatings(
      [unscored(['A', 'B'], ['C', 'D'])],
      players
    );
    expect(result.ratedMatchCount).toBe(0);
    expect(result.players).toEqual([]);
  });

  it('players に存在しない ID は除外し、片チームが空なら試合ごとスキップ', () => {
    const players = playersOf('A', 'B', 'C');
    // teamB は D/E とも未登録 → 比較情報にならないのでスキップ
    const orphan: Match = {
      ...match(['A', 'B'], ['C', 'C'], 'A'),
      teamB: ['id-D', 'id-E'],
    };
    // teamB の片方だけ未登録 → C 単独チームとして採用
    const partial: Match = {
      ...match(['A', 'B'], ['C', 'C'], 'A'),
      teamB: ['id-C', 'id-E'],
    };
    expect(computePerformanceRatings([orphan], players).ratedMatchCount).toBe(0);

    const result = computePerformanceRatings([partial], players);
    expect(result.ratedMatchCount).toBe(1);
    expect(result.players.map((p) => p.name).sort()).toEqual(['A', 'B', 'C']);
    expect(findPerformance(result, 'C')!.losses).toBe(1);
    expect(findPerformance(result, 'C')!.partnerRating).toBeNull();
  });

  it('完全に対称なデータでは全員が基準レート・偏差値50', () => {
    const players = playersOf('A', 'B', 'C', 'D');
    // 同じ組み合わせで 1 勝 1 敗ずつ → 誰も差がつかない
    const result = computePerformanceRatings(
      [match(['A', 'B'], ['C', 'D'], 'A'), match(['A', 'B'], ['C', 'D'], 'B')],
      players
    );
    for (const p of result.players) {
      expect(p.rating).toBe(BASE_RATING);
      expect(p.deviation).toBe(50);
      expect(p.wins).toBe(1);
      expect(p.losses).toBe(1);
      expect(p.winRate).toBe(50);
    }
  });

  it('弱い相手にだけ全勝した人より、強い相手に勝ち越した人が高く評価される', () => {
    const players = playersOf('S', 'A', 'B', 'C', 'D', 'F');
    const matches = [
      // D は誰にも勝てない（明確に弱い）
      match(['A'], ['D'], 'A'),
      match(['B'], ['D'], 'A'),
      match(['C'], ['D'], 'A'),
      // A/B/C は互角
      match(['A'], ['B'], 'A'),
      match(['B'], ['A'], 'A'),
      match(['B'], ['C'], 'A'),
      match(['C'], ['B'], 'A'),
      match(['A'], ['C'], 'A'),
      match(['C'], ['A'], 'A'),
      // F は弱い D にだけ 4 戦 4 勝（勝率 100%）
      match(['F'], ['D'], 'A'),
      match(['F'], ['D'], 'A'),
      match(['F'], ['D'], 'A'),
      match(['F'], ['D'], 'A'),
      // S は互角の A/B/C 相手に 3 勝 1 敗（勝率 75%）
      match(['S'], ['A'], 'A'),
      match(['S'], ['B'], 'A'),
      match(['S'], ['C'], 'A'),
      match(['S'], ['A'], 'B'),
    ];
    const result = computePerformanceRatings(matches, players);

    // 勝率だけ見ると F(100%) > S(75%)
    expect(findPerformance(result, 'F')!.winRate).toBe(100);
    expect(findPerformance(result, 'S')!.winRate).toBe(75);
    // 相手の強さを補正すると逆転する。
    // `deviation` は整数に丸めているため、この規模の差では同値になることがある
    // （実測の誤差が ±5.5 ポイントあるので丸めは意図的）。逆転そのものは丸める前の
    // `rating` で検証する。
    expect(ratingOf(result, 'S')).toBeGreaterThan(ratingOf(result, 'F'));
    expect(findPerformance(result, 'S')!.deviation).toBeGreaterThanOrEqual(
      findPerformance(result, 'F')!.deviation
    );
    // D は最下位
    expect(result.players[result.players.length - 1].name).toBe('D');
    // F の対戦相手平均レートは、S の対戦相手平均レートより低い
    expect(findPerformance(result, 'F')!.opponentRating).toBeLessThan(
      findPerformance(result, 'S')!.opponentRating
    );
    // 弱い相手に勝つのは「期待どおり」なので上振れが小さい
    expect(findPerformance(result, 'F')!.winsAboveExpected).toBeLessThan(
      findPerformance(result, 'S')!.winsAboveExpected
    );
  });

  it('ダブルスで味方の強さも考慮される（強い味方に乗っただけの人は伸びない）', () => {
    const players = playersOf('S', 'X', 'A', 'B', 'C', 'D');
    const matches = [
      // S は誰と組んでも勝つ
      match(['S', 'X'], ['A', 'B'], 'A'),
      match(['S', 'X'], ['C', 'D'], 'A'),
      match(['S', 'A'], ['C', 'D'], 'A'),
      match(['S', 'B'], ['C', 'D'], 'A'),
      // X は S 以外と組むと負ける
      match(['X', 'A'], ['C', 'D'], 'B'),
      match(['X', 'B'], ['C', 'D'], 'B'),
      match(['X', 'C'], ['A', 'B'], 'B'),
    ];
    const result = computePerformanceRatings(matches, players);
    expect(ratingOf(result, 'S')).toBeGreaterThan(ratingOf(result, 'X'));
    expect(findPerformance(result, 'S')!.partnerRating).not.toBeNull();
  });

  it('勝ち数・負け数・期待勝利数が試合数と整合する', () => {
    const players = playersOf('A', 'B', 'C', 'D');
    const matches = [
      match(['A', 'B'], ['C', 'D'], 'A'),
      match(['A', 'C'], ['B', 'D'], 'A'),
      match(['A', 'D'], ['B', 'C'], 'B'),
    ];
    const result = computePerformanceRatings(matches, players);
    expect(result.ratedMatchCount).toBe(3);
    for (const p of result.players) {
      expect(p.total).toBe(3);
      expect(p.wins + p.losses).toBe(3);
      expect(p.expectedWins).toBeGreaterThanOrEqual(0);
      expect(p.expectedWins).toBeLessThanOrEqual(3);
      // expectedWinRate は丸め前の値から算出するため、表示用に丸めた
      // expectedWins から計算した値とは 1 ポイント程度ずれうる
      expect(
        Math.abs(p.expectedWinRate! - (p.expectedWins / 3) * 100)
      ).toBeLessThanOrEqual(2);
      expect(round1(p.wins - p.expectedWins)).toBe(p.winsAboveExpected);
    }
    // 期待勝利数の総和は試合数の合計（1 試合で必ず片方が勝つ）に一致する
    const totalExpected = result.players.reduce((s, p) => s + p.expectedWins, 0);
    expect(totalExpected).toBeCloseTo(6, 0);
  });

  it('偏差値は平均 50 / 母標準偏差 10 に概ね揃う（整数丸めのぶん誤差が出る）', () => {
    const players = playersOf('A', 'B', 'C', 'D', 'E', 'F');
    const matches = [
      match(['A', 'B'], ['C', 'D'], 'A'),
      match(['A', 'C'], ['E', 'F'], 'A'),
      match(['B', 'D'], ['E', 'F'], 'B'),
      match(['A', 'E'], ['B', 'F'], 'A'),
      match(['C', 'D'], ['E', 'F'], 'A'),
      match(['A', 'F'], ['C', 'E'], 'A'),
    ];
    const result = computePerformanceRatings(matches, players);
    const deviations = result.players.map((p) => p.deviation);
    const mean = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    const sd = Math.sqrt(
      deviations.reduce((s, v) => s + (v - mean) ** 2, 0) / deviations.length
    );
    // `deviation` は整数に丸めているので厳密には 50 / 10 にならない。
    // 丸め幅（±0.5）の範囲で一致していればよい。
    expect(mean).toBeGreaterThan(49.5);
    expect(mean).toBeLessThan(50.5);
    expect(sd).toBeGreaterThan(9.5);
    expect(sd).toBeLessThan(10.5);
  });

  it('同じ偏差値は同順位になり、次の順位は人数分飛ぶ（1,2,2,4 形式）', () => {
    // 全員が1勝1敗で完全に対称 → 偏差値は全員 50 に潰れる
    const players = playersOf('A', 'B', 'C', 'D');
    const result = computePerformanceRatings(
      [
        match(['A', 'B'], ['C', 'D'], 'A'),
        match(['C', 'D'], ['A', 'B'], 'A'),
      ],
      players
    );
    expect(result.players.every((p) => p.deviation === 50)).toBe(true);
    expect(result.players.map((p) => p.displayRank)).toEqual([1, 1, 1, 1]);
  });

  it('同じ偏差値のときは登録レートが高い方を上に表示する', () => {
    // 上と同じ対称なデータ。登録レートだけ差をつける
    const players = [
      { ...playersOf('A')[0], rating: 10 },
      { ...playersOf('B')[0], rating: 40 },
      { ...playersOf('C')[0], rating: 20 },
      { ...playersOf('D')[0], rating: 30 },
    ];
    const result = computePerformanceRatings(
      [
        match(['A', 'B'], ['C', 'D'], 'A'),
        match(['C', 'D'], ['A', 'B'], 'A'),
      ],
      players
    );
    expect(result.players.map((p) => p.name)).toEqual(['B', 'D', 'C', 'A']);
  });

  it('レート降順に並び、同レートは勝ち数→五十音で安定する', () => {
    const players = playersOf('A', 'B', 'C', 'D');
    const result = computePerformanceRatings(
      [match(['A', 'B'], ['C', 'D'], 'A'), match(['A', 'C'], ['B', 'D'], 'A')],
      players
    );
    const ratings = result.players.map((p) => p.rating);
    expect([...ratings].sort((x, y) => y - x)).toEqual(ratings);
    expect(result.players[0].name).toBe('A');
    expect(result.players[result.players.length - 1].name).toBe('D');
  });

  it('全勝でもレートは発散せず、試合数が少ないほど平均に近い', () => {
    const players = playersOf('A', 'B', 'C', 'D');
    const few = computePerformanceRatings(
      [match(['A'], ['B'], 'A')],
      players
    );
    const many = computePerformanceRatings(
      [
        match(['A'], ['B'], 'A'),
        match(['A'], ['C'], 'A'),
        match(['A'], ['D'], 'A'),
        match(['A'], ['B'], 'A'),
        match(['A'], ['C'], 'A'),
        match(['A'], ['D'], 'A'),
      ],
      players
    );
    expect(ratingOf(few, 'A')).toBeGreaterThan(BASE_RATING);
    expect(ratingOf(many, 'A')).toBeGreaterThan(ratingOf(few, 'A'));
    expect(ratingOf(many, 'A')).toBeLessThan(BASE_RATING + 600);
  });

  it('試合順を入れ替えても同じ結果になる（オンライン Elo と違い順序非依存）', () => {
    const players = playersOf('A', 'B', 'C', 'D');
    const matches = [
      match(['A', 'B'], ['C', 'D'], 'A'),
      match(['A', 'C'], ['B', 'D'], 'A'),
      match(['A', 'D'], ['B', 'C'], 'B'),
    ];
    const forward = computePerformanceRatings(matches, players);
    const backward = computePerformanceRatings([...matches].reverse(), players);
    for (const p of forward.players) {
      expect(findPerformance(backward, p.name)!.rating).toBe(p.rating);
    }
  });

  it('findPerformance は null 名や未参加者に null を返す', () => {
    const players = playersOf('A', 'B', 'C', 'D');
    const result = computePerformanceRatings(
      [match(['A', 'B'], ['C', 'D'], 'A')],
      players
    );
    expect(findPerformance(result, null)).toBeNull();
    expect(findPerformance(result, 'Zoe')).toBeNull();
    expect(findPerformance(result, 'A')!.wins).toBe(1);
  });
});

describe('genderDeviation（男女別偏差値）', () => {
  const withGender = (name: string, gender?: 'M' | 'F'): Player => ({
    ...makePlayer(name),
    gender,
  });
  const names = ['M1', 'M2', 'M3', 'M4', 'F1', 'F2', 'F3', 'F4'];
  const build = (genders: Record<string, 'M' | 'F' | undefined>) => {
    const players = names.map((n) => withGender(n, genders[n]));
    const matches = [
      match(['M1', 'F1'], ['M2', 'F2'], 'A'),
      match(['M1', 'F2'], ['M3', 'F3'], 'A'),
      match(['M2', 'F1'], ['M4', 'F4'], 'A'),
      match(['M3', 'F4'], ['M4', 'F3'], 'B'),
      match(['M1', 'M4'], ['M2', 'M3'], 'A'),
      match(['F1', 'F4'], ['F2', 'F3'], 'A'),
      match(['M1', 'F3'], ['M4', 'F2'], 'A'),
    ];
    return { players, matches };
  };
  const allGenders = Object.fromEntries(
    names.map((n) => [n, n.startsWith('M') ? 'M' : 'F'])
  ) as Record<string, 'M' | 'F'>;

  it('各性別内で平均≒50・標準偏差≒10', () => {
    const { players, matches } = build(allGenders);
    const res = computePerformanceRatings(matches, players);
    for (const g of ['M', 'F'] as const) {
      const vals = res.players
        .filter((p) => p.gender === g)
        .map((p) => p.genderDeviation as number);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sd = Math.sqrt(
        vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length
      );
      expect(mean).toBeCloseTo(50, 0);
      expect(sd).toBeGreaterThan(8);
      expect(sd).toBeLessThan(12);
    }
  });

  it('性別未設定は null', () => {
    const { players, matches } = build({ ...allGenders, M1: undefined });
    const res = computePerformanceRatings(matches, players);
    expect(findPerformance(res, 'M1')!.genderDeviation).toBeNull();
    expect(findPerformance(res, 'M2')!.genderDeviation).not.toBeNull();
  });

  it('同性が1人だけなら 50', () => {
    const { players, matches } = build({
      ...allGenders,
      F2: undefined,
      F3: undefined,
      F4: undefined,
    });
    const res = computePerformanceRatings(matches, players);
    expect(findPerformance(res, 'F1')!.genderDeviation).toBe(50);
  });

  it('全体の deviation は性別設定の有無で変わらない', () => {
    const { players, matches } = build(allGenders);
    const plain = build({});
    const a = computePerformanceRatings(matches, players);
    const b = computePerformanceRatings(plain.matches, plain.players);
    for (const p of a.players) {
      expect(findPerformance(b, p.name)!.deviation).toBe(p.deviation);
      expect(findPerformance(b, p.name)!.rating).toBe(p.rating);
    }
  });
});

describe('reassignDisplayRanks', () => {
  /**
   * プレイヤーのスタブを作成（テスト用に必要な最小限のフィールドを持つ）
   */
  const createPerformanceStub = (overrides: Partial<PlayerPerformance> = {}): PlayerPerformance => ({
    name: 'Test',
    wins: 0,
    losses: 0,
    total: 0,
    winRate: null,
    rating: BASE_RATING,
    deviation: 50,
    genderDeviation: null,
    gender: null,
    displayRank: 0,
    opponentRating: BASE_RATING,
    opponentDeviation: 50,
    partnerRating: null,
    partnerDeviation: null,
    expectedWins: 0,
    expectedWinRate: null,
    winsAboveExpected: 0,
    winsAboveExpectedError: 0,
    isSignificant: false,
    ...overrides,
  });

  it('空リストを渡すと空リストを返す', () => {
    const result = reassignDisplayRanks([]);
    expect(result).toEqual([]);
  });

  it('男女混在リストから女だけに絞ると 1 から振り直される', () => {
    // 全員から女子だけに絞った場合のシミュレーション
    const women = [
      createPerformanceStub({ name: 'A', gender: 'F', deviation: 60 }),
      createPerformanceStub({ name: 'B', gender: 'F', deviation: 55 }),
      createPerformanceStub({ name: 'C', gender: 'F', deviation: 50 }),
    ];
    const result = reassignDisplayRanks(women);
    expect(result[0].displayRank).toBe(1);
    expect(result[1].displayRank).toBe(2);
    expect(result[2].displayRank).toBe(3);
  });

  it('同じ偏差値は同順位で、次が飛ぶ（1,2,2,4 形式）', () => {
    const players = [
      createPerformanceStub({ name: 'A', deviation: 60 }),
      createPerformanceStub({ name: 'B', deviation: 55 }),
      createPerformanceStub({ name: 'C', deviation: 55 }),
      createPerformanceStub({ name: 'D', deviation: 50 }),
    ];
    const result = reassignDisplayRanks(players);
    expect(result.map((p) => p.displayRank)).toEqual([1, 2, 2, 4]);
  });

  it('すべてが同じ偏差値なら全員 1 位', () => {
    const players = [
      createPerformanceStub({ name: 'A', deviation: 50 }),
      createPerformanceStub({ name: 'B', deviation: 50 }),
      createPerformanceStub({ name: 'C', deviation: 50 }),
    ];
    const result = reassignDisplayRanks(players);
    expect(result.map((p) => p.displayRank)).toEqual([1, 1, 1]);
  });

  it('元の配列を破壊しない（イミュータブル）', () => {
    const original = [
      createPerformanceStub({ name: 'A', displayRank: 1 }),
      createPerformanceStub({ name: 'B', displayRank: 2 }),
    ];
    const originalCopy = JSON.parse(JSON.stringify(original));
    reassignDisplayRanks(original);
    expect(original).toEqual(originalCopy);
  });

  it('返却値の各要素は新しいオブジェクト（元の参照は保持しない）', () => {
    const original = [
      createPerformanceStub({ name: 'A', displayRank: 1 }),
      createPerformanceStub({ name: 'B', displayRank: 2 }),
    ];
    const result = reassignDisplayRanks(original);
    expect(result[0]).not.toBe(original[0]);
    expect(result[1]).not.toBe(original[1]);
  });

  it('相対順序は変わらない（元のソート順を保持）', () => {
    const players = [
      createPerformanceStub({ name: 'Z', deviation: 60 }),
      createPerformanceStub({ name: 'A', deviation: 50 }),
      createPerformanceStub({ name: 'M', deviation: 55 }),
    ];
    const result = reassignDisplayRanks(players);
    expect(result.map((p) => p.name)).toEqual(['Z', 'A', 'M']);
  });
});

describe('judgeMatch', () => {
  it('有利（0.60 以上）: 勝ちは順当勝ち、負けは取りこぼし。境界を含む', () => {
    expect(judgeMatch(0.60, true)).toBe('expected-win');
    expect(judgeMatch(0.60, false)).toBe('missed-win');
    expect(judgeMatch(0.9, true)).toBe('expected-win');
  });
  it('不利（0.40 以下）: 勝ちは番狂わせ勝ち、負けは順当負け。境界を含む', () => {
    expect(judgeMatch(0.40, true)).toBe('upset-win');
    expect(judgeMatch(0.40, false)).toBe('expected-loss');
    expect(judgeMatch(0.1, false)).toBe('expected-loss');
  });
  it('中間は互角', () => {
    expect(judgeMatch(0.5, true)).toBe('even-win');
    expect(judgeMatch(0.5, false)).toBe('even-loss');
    expect(judgeMatch(0.5999, false)).toBe('even-loss');
    expect(judgeMatch(0.4001, true)).toBe('even-win');
  });
});

describe('matchInsights', () => {
  const players = playersOf('A', 'B', 'C', 'D');
  const history = [
    match(['A', 'B'], ['C', 'D'], 'A'),
    match(['A', 'B'], ['C', 'D'], 'A'),
    match(['A', 'C'], ['B', 'D'], 'A'),
    match(['A', 'D'], ['B', 'C'], 'A'),
  ];

  it('試合が無ければ空', () => {
    expect(computePerformanceRatings([], players).matchInsights.size).toBe(0);
  });

  it('強いチームの予想勝率が 0.5 を超え、平均偏差も高い', () => {
    const result = computePerformanceRatings(history, players);
    const insight = result.matchInsights.get(history[0].id)!;
    expect(insight.winProbabilityA).toBeGreaterThan(0.5);
    expect(insight.teamADeviation).toBeGreaterThan(insight.teamBDeviation);
    expect(Number.isInteger(insight.teamADeviation)).toBe(true);
  });

  it('結果未入力の試合は含まれない', () => {
    const pending = unscored(['A', 'B'], ['C', 'D']);
    const result = computePerformanceRatings([...history, pending], players);
    expect(result.matchInsights.has(pending.id)).toBe(false);
    expect(result.matchInsights.size).toBe(history.length);
  });

  it('A/B を入れ替えると予想勝率の和が 1 になり、偏差も入れ替わる', () => {
    const ab = match(['A', 'B'], ['C', 'D'], 'A');
    const ba = match(['C', 'D'], ['A', 'B'], 'B');
    const result = computePerformanceRatings([ab, ba], players);
    const i1 = result.matchInsights.get(ab.id)!;
    const i2 = result.matchInsights.get(ba.id)!;
    expect(i1.winProbabilityA + i2.winProbabilityA).toBeCloseTo(1, 10);
    expect(i1.teamADeviation).toBe(i2.teamBDeviation);
    expect(i1.teamBDeviation).toBe(i2.teamADeviation);
  });
});

describe('matchInsights: leave-one-out', () => {
  const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

  it('勝者側の LOO 予想勝率は、その試合を含めて解いた値（in-sample）より 0.5 に近い', () => {
    // シングルス: A が B に 3 勝、B が C に 1 勝。in-sample はテスト内で素朴に解く
    const games = [
      ['A', 'B', 'A'], ['A', 'B', 'A'], ['A', 'B', 'A'], ['B', 'C', 'A'],
    ] as const;
    const ms = games.map(([a, b, w]) => match([a], [b], w === 'A' ? 'A' : 'B'));
    const theta: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (let it = 0; it < 5000; it++) {
      const g: Record<string, number> = { A: 0, B: 0, C: 0 };
      for (const [a, b] of games) {
        const r = 1 - sigmoid(theta[a] - theta[b]);
        g[a] += r;
        g[b] -= r;
      }
      for (const n of Object.keys(theta)) theta[n] += 0.05 * (g[n] - 0.5 * theta[n]);
    }
    const inSample = sigmoid(theta.A - theta.B);
    const result = computePerformanceRatings(ms, playersOf('A', 'B', 'C'));
    const loo = result.matchInsights.get(ms[0].id)!.winProbabilityA;
    expect(loo).toBeGreaterThanOrEqual(0.5);
    expect(Math.abs(loo - 0.5)).toBeLessThan(Math.abs(inSample - 0.5));
  });

  it('その試合にしか出ない選手だけのチーム同士は 0.5', () => {
    const others = [match(['A', 'B'], ['C', 'D'], 'A'), match(['A', 'C'], ['B', 'D'], 'B')];
    const solo = match(['E', 'F'], ['G', 'H'], 'A');
    const result = computePerformanceRatings(
      [...others, solo],
      playersOf('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H')
    );
    expect(result.matchInsights.get(solo.id)!.winProbabilityA).toBeCloseTo(0.5, 10);
  });

  it('不変条件: 平均偏差の大小と予想勝率の向きが一致する（複数試合）', () => {
    const players = playersOf('A', 'B', 'C', 'D', 'E');
    const ms = [
      match(['A', 'B'], ['C', 'D'], 'A'),
      match(['A', 'C'], ['B', 'E'], 'A'),
      match(['B', 'D'], ['A', 'E'], 'B'),
      match(['C', 'E'], ['A', 'D'], 'B'),
      match(['A', 'B'], ['D', 'E'], 'A'),
      match(['B', 'C'], ['A', 'D'], 'A'),
    ];
    const result = computePerformanceRatings(ms, players);
    for (const m of ms) {
      const i = result.matchInsights.get(m.id)!;
      if (i.teamADeviation > i.teamBDeviation) expect(i.winProbabilityA).toBeGreaterThan(0.5);
      else if (i.teamADeviation < i.teamBDeviation) expect(i.winProbabilityA).toBeLessThan(0.5);
    }
  });

  it('勝ったことで評価が逆転する: LOO では弱い側が勝者で、偏差は勝者側が低く予想勝率 < 0.5', () => {
    // A は B に 1 勝 2 敗（全体では B が上）。最初の A 勝ちを除くと B がより強く見える
    const ms = [
      match(['A'], ['B'], 'A'),
      match(['A'], ['B'], 'B'),
      match(['A'], ['B'], 'B'),
    ];
    const result = computePerformanceRatings(ms, playersOf('A', 'B'));
    const i = result.matchInsights.get(ms[0].id)!;
    expect(i.winProbabilityA).toBeLessThan(0.5);
    expect(i.teamADeviation).toBeLessThan(i.teamBDeviation);
  });

  it('LOO 偏差は全体推定の mean/sd で正規化される（その試合にしか出ない選手は θ=0 相当）', () => {
    const others = [match(['A', 'B'], ['C', 'D'], 'A'), match(['A', 'C'], ['B', 'D'], 'B')];
    const solo = match(['E', 'F'], ['G', 'H'], 'A');
    const result = computePerformanceRatings(
      [...others, solo],
      playersOf('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H')
    );
    const i = result.matchInsights.get(solo.id)!;
    expect(i.teamADeviation).toBe(i.teamBDeviation);
  });

  it('80 試合規模でも実行時間が現実的（緩い上限）', () => {
    const names = Array.from({ length: 16 }, (_, i) => `P${i}`);
    const players = playersOf(...names);
    const ms: Match[] = [];
    for (let i = 0; i < 80; i++) {
      const p = (k: number) => names[(i * 3 + k * 5) % 16];
      const t1 = [p(0), p(1)];
      const t2 = [p(2), p(3)];
      if (new Set([...t1, ...t2]).size < 4) continue;
      ms.push(match(t1, t2, i % 3 === 0 ? 'B' : 'A'));
    }
    const start = performance.now();
    const result = computePerformanceRatings(ms, players);
    const elapsed = performance.now() - start;
    expect(result.matchInsights.size).toBe(ms.length);
    expect(elapsed).toBeLessThan(3000);
  });
});

describe('getPlayerMatchInsight / countVerdicts', () => {
  const players = playersOf('A', 'B', 'C', 'D');
  const history = [
    match(['A', 'B'], ['C', 'D'], 'A'),
    match(['A', 'B'], ['C', 'D'], 'A'),
    match(['C', 'D'], ['A', 'B'], 'B'),
    match(['A', 'C'], ['B', 'D'], 'B'),
  ];
  const { matchInsights } = computePerformanceRatings(history, players);

  it('本人が B 側なら勝率を反転して返す', () => {
    const view = getPlayerMatchInsight(history[2], 'A', players, matchInsights)!;
    expect(view.ownIsA).toBe(false);
    expect(view.ownWinProbability).toBeCloseTo(1 - matchInsights.get(history[2].id)!.winProbabilityA, 10);
  });

  it('不参加・分析なしは null', () => {
    expect(getPlayerMatchInsight(history[0], 'Z', players, matchInsights)).toBeNull();
    expect(getPlayerMatchInsight(unscored(['A', 'B'], ['C', 'D']), 'A', players, matchInsights)).toBeNull();
  });

  it('内訳の合計は勝敗確定試合数、0件の種類は含まれず表示順', () => {
    const counts = countVerdicts(history, 'A', players, matchInsights);
    expect(counts.reduce((s, c) => s + c.count, 0)).toBe(4);
    expect(counts.every((c) => c.count > 0)).toBe(true);
    const order = ['upset-win', 'expected-win', 'even-win', 'even-loss', 'missed-win', 'expected-loss'];
    const idx = counts.map((c) => order.indexOf(c.verdict));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });
});

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

describe('judgeMatchNeutral', () => {
  it('境界と中間を判定する', () => {
    expect(judgeMatchNeutral(0.60)).toBe('expected');
    expect(judgeMatchNeutral(0.9)).toBe('expected');
    expect(judgeMatchNeutral(0.40)).toBe('upset');
    expect(judgeMatchNeutral(0.1)).toBe('upset');
    expect(judgeMatchNeutral(0.5)).toBe('even');
    expect(judgeMatchNeutral(0.5999)).toBe('even');
    expect(judgeMatchNeutral(0.4001)).toBe('even');
  });
});

describe('estimateStrengthsById', () => {
  const mk = (id: string, a: [string, string], b: [string, string], winner?: 'A' | 'B'): Match => ({
    id, courtId: 1, teamA: a, teamB: b, scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, ...(winner ? { winner } : {}),
  });

  it('勝敗が無い履歴・空のチームは数えず、空の Map を返す', () => {
    expect(estimateStrengthsById([]).size).toBe(0);
    expect(estimateStrengthsById([mk('m1', ['a', 'b'], ['c', 'd'])]).size).toBe(0);
    expect(estimateStrengthsById([mk('m2', ['', ''], ['c', 'd'], 'A')]).size).toBe(0);
  });

  it('勝ち続けた側の θ が高く、試合数を数える。同じ入力なら同じ結果', () => {
    const ms = [mk('m1', ['a', 'b'], ['c', 'd'], 'A'), mk('m2', ['a', 'c'], ['b', 'd'], 'A'), mk('m3', ['a', 'd'], ['b', 'c'], 'A')];
    const r = estimateStrengthsById(ms);
    expect(r.get('a')!.games).toBe(3);
    expect(r.get('a')!.theta).toBeGreaterThan(r.get('d')!.theta);
    expect(estimateStrengthsById(ms)).toEqual(r);
  });
});

// --- 登録レートを事前分布に使う／スコア差を軽く反映する（docs/plans/2026-10-05-performance-rating-prior-and-score.md） ---

const rated = (name: string, rating?: number): Player => ({ ...makePlayer(name), rating });
const withRatings = (ratings: Record<string, number | undefined>): Player[] =>
  Object.entries(ratings).map(([n, r]) => rated(n, r));
const noRatings = (ratings: Record<string, number | undefined>): Player[] =>
  Object.keys(ratings).map(makePlayer);
const scored = (
  teamA: string[],
  teamB: string[],
  scoreA: number,
  scoreB: number
): Match => ({
  ...match(teamA, teamB, scoreA >= scoreB ? 'A' : 'B'),
  scoreA,
  scoreB,
});
const devOf = (result: ReturnType<typeof computePerformanceRatings>, name: string) =>
  findPerformance(result, name)!.deviation;

describe('登録レートの事前分布', () => {
  const ratings = { H: 1800, X: 1400, L1: 1000, L2: 1100, M1: 1300, M2: 1500 };
  // X は高レートの H と組み、低レートの相手にだけ勝つ（その他は互角の試合）
  const matches = () => [
    match(['H', 'X'], ['L1', 'L2'], 'A'),
    match(['H', 'X'], ['L1', 'L2'], 'A'),
    match(['H', 'X'], ['L1', 'L2'], 'A'),
    match(['H', 'M1'], ['M2', 'L1'], 'A'),
    match(['M2', 'L2'], ['M1', 'L1'], 'A'),
    match(['M1', 'L2'], ['M2', 'L1'], 'B'),
  ];

  it('高レートの味方と組み低レートの相手に勝った人は、レート情報なしより偏差値が低い', () => {
    const ms = matches();
    const withPrior = computePerformanceRatings(ms, withRatings(ratings));
    const without = computePerformanceRatings(ms, noRatings(ratings));
    expect(devOf(withPrior, 'X')).toBeLessThan(devOf(without, 'X'));
  });

  it('少数試合の人ほど登録レート順に寄る（試合が無いほど差がレート順）', () => {
    // 1試合だけ同じ結果の2人: 登録レートが高い方が高く推定される
    const players = withRatings({ A: 1600, B: 1200, C: 1400, D: 1400 });
    const result = computePerformanceRatings([match(['A', 'B'], ['C', 'D'], 'A')], players);
    expect(ratingOf(result, 'A')).toBeGreaterThan(ratingOf(result, 'B'));
  });

  it('全員同レートなら登録レートなしと同じ結果', () => {
    const r = { A: 1500, B: 1500, C: 1500, D: 1500, E: 1500 };
    const ms = [
      match(['A', 'B'], ['C', 'D'], 'A'),
      match(['A', 'E'], ['C', 'D'], 'A'),
      match(['B', 'E'], ['A', 'C'], 'B'),
    ];
    const a = computePerformanceRatings(ms, withRatings(r));
    const b = computePerformanceRatings(ms, noRatings(r));
    expect(a.players.map((p) => [p.name, p.rating])).toEqual(
      b.players.map((p) => [p.name, p.rating])
    );
  });

  it('レート登録者が1人だけ・0 や未設定のみなら登録レートなしと同じ結果', () => {
    const r = { A: 1800, B: undefined, C: 0, D: undefined };
    const ms = [match(['A', 'B'], ['C', 'D'], 'A'), match(['A', 'C'], ['B', 'D'], 'B')];
    const a = computePerformanceRatings(ms, withRatings(r));
    const b = computePerformanceRatings(ms, noRatings(r));
    expect(a.players.map((p) => [p.name, p.rating])).toEqual(
      b.players.map((p) => [p.name, p.rating])
    );
  });

  it('レートの尺度（30〜40 と 1500 台）が違っても、順位関係が同じなら同じ結果になる', () => {
    const small = { H: 40, X: 34, L1: 30, L2: 31, M1: 33, M2: 36 };
    const a = computePerformanceRatings(matches(), withRatings(ratings));
    const b = computePerformanceRatings(matches(), withRatings(small));
    // 線形変換ではないので厳密一致はしないが、強さの順序は保たれる
    expect(devOf(b, 'H')).toBeGreaterThan(devOf(b, 'L1'));
    expect(devOf(a, 'H')).toBeGreaterThan(devOf(a, 'L1'));
  });

  it('レート差を入れても試合順に依存しない', () => {
    const ms = matches();
    const a = computePerformanceRatings(ms, withRatings(ratings));
    const b = computePerformanceRatings([...ms].reverse(), withRatings(ratings));
    for (const p of a.players) expect(ratingOf(b, p.name)).toBe(p.rating);
  });

  it('レート差を入れても偏差値は平均≒50 / 標準偏差≒10', () => {
    const result = computePerformanceRatings(matches(), withRatings(ratings));
    const devs = result.players.map((p) => p.deviation);
    const m = devs.reduce((x, y) => x + y, 0) / devs.length;
    const sd = Math.sqrt(devs.reduce((s, d) => s + (d - m) ** 2, 0) / devs.length);
    expect(m).toBeGreaterThan(48);
    expect(m).toBeLessThan(52);
    expect(sd).toBeGreaterThan(8);
    expect(sd).toBeLessThan(12);
  });

  it('LOO の予想勝率も登録レートを反映する（高レート側が有利）', () => {
    const ms = [match(['H', 'X'], ['L1', 'L2'], 'B'), match(['M1', 'M2'], ['L1', 'X'], 'A')];
    const result = computePerformanceRatings(ms, withRatings(ratings));
    // 1試合目: 高レート側(A)が負けているが、除外して解くと H の事前が効いて A が有利
    expect(result.matchInsights.get(ms[0].id)!.winProbabilityA).toBeGreaterThan(0.5);
  });
});

describe('スコア差の軽い反映', () => {
  const players = playersOf('A', 'B', 'C', 'D', 'E', 'F');
  const base = (scoreA: number, scoreB: number) => [
    scored(['A', 'B'], ['C', 'D'], scoreA, scoreB),
    match(['E', 'F'], ['C', 'D'], 'A'),
    match(['A', 'E'], ['B', 'F'], 'B'),
  ];

  it('21-5 の勝ちは 21-19 の勝ちより偏差値が高い', () => {
    const big = computePerformanceRatings(base(21, 5), players);
    const close = computePerformanceRatings(base(21, 19), players);
    expect(findPerformance(big, 'A')!.rating).toBeGreaterThan(
      findPerformance(close, 'A')!.rating
    );
  });

  it('スコア 0-0 は勝敗のみと同じ（スコア未入力でも勝者がいる場合）', () => {
    const zero = computePerformanceRatings(
      [{ ...match(['A', 'B'], ['C', 'D'], 'A'), scoreA: 0, scoreB: 0 }],
      players
    );
    // 勝敗のみ = outcome が 1/0 の従来推定。estimateStrengthsById（勝敗のみ）と同じ向き・大きさ
    const byId = estimateStrengthsById([
      { ...match(['A', 'B'], ['C', 'D'], 'A'), scoreA: 0, scoreB: 0 },
    ]);
    expect(ratingOf(zero, 'A')).toBe(
      Math.round(BASE_RATING + byId.get('id-A')!.theta * (400 / Math.LN10))
    );
  });

  it('勝者のみ入力のダミースコア（100-99 / 99-100）は勝敗のみ（0-0）と同じ結果', () => {
    const zero = computePerformanceRatings(base(0, 0), players);
    const winA = computePerformanceRatings(base(100, 99), players);
    const dummyB = computePerformanceRatings(
      [scored(['C', 'D'], ['A', 'B'], 99, 100), ...base(0, 0).slice(1)],
      players
    );
    for (const name of ['A', 'B', 'C', 'D', 'E', 'F']) {
      expect(ratingOf(winA, name)).toBe(ratingOf(zero, name));
      expect(ratingOf(dummyB, name)).toBe(ratingOf(zero, name));
    }
  });

  it('スコアが大差でも勝敗は覆らない（勝者の方が高い）', () => {
    const result = computePerformanceRatings(
      [scored(['A', 'B'], ['C', 'D'], 21, 20)],
      players
    );
    expect(ratingOf(result, 'A')).toBeGreaterThan(ratingOf(result, 'C'));
    expect(findPerformance(result, 'A')!.wins).toBe(1);
  });
});

describe('登録レートの事前分布: ばらつきが小さい／外れ値のとき', () => {
  const names = Array.from({ length: 20 }, (_, i) => `P${i}`);
  // 全員が同じ勝敗データ（P0 と P1 が組んで P2,P3 に勝つ。他は互角）
  const ms = () => [
    match(['P0', 'P4'], ['P2', 'P3'], 'A'),
    match(['P1', 'P5'], ['P6', 'P7'], 'A'),
    match(['P8', 'P9'], ['P10', 'P11'], 'A'),
    match(['P12', 'P13'], ['P14', 'P15'], 'A'),
    match(['P16', 'P17'], ['P18', 'P19'], 'A'),
  ];

  it('1500 が多数＋1510 が1人でも、1510 の人の事前の影響は小さい', () => {
    // P8 だけ 1510、他は 1500。P8 はデータ上は他の勝者と同じ扱い
    const r: Record<string, number> = {};
    for (const n of names) r[n] = n === 'P8' ? 1510 : 1500;
    const result = computePerformanceRatings(ms(), withRatings(r));
    const flat = computePerformanceRatings(ms(), noRatings(r));
    // 同じ勝敗データの 1500 のペア（P9）との差は数十レート以内（下限なしだと +450 級に拡大されていた）。
    // 偏差値はこの日の差が小さいため数ポイントに見えるが、レート差で見ると十数点。
    expect(Math.abs(ratingOf(result, 'P8') - ratingOf(result, 'P9'))).toBeLessThan(30);
    expect(Math.abs(devOf(result, 'P8') - devOf(result, 'P9'))).toBeLessThanOrEqual(8);
    expect(Math.abs(ratingOf(result, 'P8') - ratingOf(flat, 'P8'))).toBeLessThan(40);
  });

  it('外れ値は z が ±2.5 で頭打ちになり、極端な値でも結果が変わらない', () => {
    // 平均・sd が違っても、外れ値が2.5SD を超えるなら事前平均は同じ（クランプ）
    const make = (outlier: number) => {
      const r: Record<string, number> = {};
      for (const n of names) r[n] = 1500;
      r.P8 = outlier;
      r.P9 = outlier;
      return computePerformanceRatings(ms(), withRatings(r));
    };
    // 2人が外れ値（20人中）: z = (x-m)/sd = 3 > 2.5。外れ値が 3000 でも 30000 でも同じ
    const a = make(3000);
    const b = make(30000);
    for (const n of names) expect(ratingOf(b, n)).toBe(ratingOf(a, n));
  });
});
