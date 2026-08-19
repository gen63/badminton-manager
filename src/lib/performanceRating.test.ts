import { describe, it, expect } from 'vitest';
import {
  computePerformanceRatings,
  findPerformance,
  BASE_RATING,
} from './performanceRating';
import type { Match } from '../types/match';
import type { Player } from '../types/player';

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

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
