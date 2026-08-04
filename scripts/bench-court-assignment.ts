/**
 * コート配置ベンチマーク（真の実力基準）
 *
 * `src/lib/algorithm.ts` の `assignCourts` を**実際に呼んで**計測する。
 * `scripts/simulate-court-assignment.ts` はロジックを再実装した独立シミュレータで
 * 本番の変更を計測できないため、アルゴリズム変更の効果測定にはこちらを使う。
 *
 * ## 循環計測を避ける設計
 *
 * 各プレイヤーは **真の実力 `trueRank`** を持ち、`player.rating` は
 * `trueRank` にノイズ（±NOISE 順位）を乗せた写し＝「古くなった手動序列」を表す。
 * 勝敗は `trueRank` から Bradley-Terry で確率的に決め、**分離の評価も `trueRank`
 * 基準**で行う。
 *
 * `player.rating` を正解とみなして測ると、序列を動かす仕組み（ハシゴ式
 * `applyStreakSwaps`）は勝敗で人を動かした時点で必ず「正解」から離れ、悪化して
 * 見える。これでは「アルゴリズムが悪い」のか「序列が古いだけ」なのか区別できない。
 * 詳細は docs/plans/2026-07-29-ladder-drift-limit.md を参照。
 *
 * ## 使い方
 *
 * ```bash
 * npx tsx scripts/bench-court-assignment.ts                 # 既定 (SEEDS=150, NOISE=0,4,8)
 * SEEDS=50 NOISE=4 npx tsx scripts/bench-court-assignment.ts
 * CONDITIONS=21x3 npx tsx scripts/bench-court-assignment.ts
 * ```
 *
 * アルゴリズム変更の効果を見るには、変更前後で同じ引数で実行して出力を比較する。
 * シードが同じなら人員構成・勝敗の乱数列は完全に再現される。
 */
import { assignCourts } from '../src/lib/algorithm';
import type { Player } from '../src/types/player';
import type { Match } from '../src/types/match';

// ---- 決定的乱数 (mulberry32) ----
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface BenchPlayer extends Player {
  /** 真の実力順位。0 が最強。評価は常にこちらを使う */
  trueRank: number;
}

/**
 * ロースターを生成する。
 * `trueRank` は 0..n-1。`rating` は `trueRank` にノイズを乗せて並べ直した写しなので、
 * NOISE が大きいほど「手動序列が実力と食い違っている」状況になる。
 */
function makeRoster(n: number, noise: number, rng: () => number): BenchPlayer[] {
  const withNoise = Array.from({ length: n }, (_, trueRank) => ({
    trueRank,
    noisy: trueRank + (noise > 0 ? (rng() * 2 - 1) * noise : 0),
  }));
  // ノイズ込みの並び順が「アプリに登録されている序列」になる
  const displayed = [...withNoise].sort((a, b) => a.noisy - b.noisy);

  const players: BenchPlayer[] = [];
  displayed.forEach((entry, displayIndex) => {
    players.push({
      id: `p${entry.trueRank}`,
      name: `P${entry.trueRank}`,
      // 表示序列の上位ほど高レート。buildInitialOrder は rating > 0 を要求する
      rating: 40 - displayIndex * 0.8,
      gender: rng() < 0.45 ? 'F' : 'M',
      isResting: false,
      gamesPlayed: 0,
      lastPlayedAt: 0,
      activatedAt: 0,
      trueRank: entry.trueRank,
    });
  });
  return players;
}

/** Bradley-Terry。真の実力が高いチームほど勝ちやすいが、番狂わせも起きる */
function teamWins(
  teamA: BenchPlayer[],
  teamB: BenchPlayer[],
  n: number,
  rng: () => number
): boolean {
  const strength = (t: BenchPlayer[]) =>
    t.reduce((s, p) => s + (n - 1 - p.trueRank), 0);
  const diff = strength(teamA) - strength(teamB);
  const pA = 1 / (1 + Math.pow(10, -diff / 8));
  return rng() < pA;
}

interface RunResult {
  separation: number;      // 真の上位3人×下位3人が同コートに入った試合の割合
  trueGap: number;         // 4人の trueRank の最大−最小の平均
  gamesSpread: number;     // 最多試合数 − 最少試合数
  rotation: number;        // 1人あたりの経験コート数の平均
  distinctMates: number;   // 1人あたりの異なる共演相手数の平均
  maxPairRepeat: number;   // 同一ペア（味方）の最大再演回数
  matches: number;
}

const MIXED_WINDOW_MS = 60_000; // これ以内に終わるコートは同時配置扱い

function runOnce(
  n: number,
  courtCount: number,
  rounds: number,
  noise: number,
  seed: number
): RunResult | null {
  const rng = makeRng(seed);
  const players = makeRoster(n, noise, rng);
  const byId = new Map(players.map(p => [p.id, p]));
  const history: Match[] = []; // 古い順（末尾が最新）

  const courtBusyUntil = new Map<number, number>(); // courtId -> 終了時刻
  const courtOccupants = new Map<number, string[]>();
  const courtIds = Array.from({ length: courtCount }, (_, i) => i + 1);
  for (const id of courtIds) courtBusyUntil.set(id, 0);

  const targetMatches = rounds * courtCount;
  let now = 0;
  let matchSeq = 0;

  while (history.length < targetMatches) {
    // 最も早く空くコートを起点に、MIXED_WINDOW_MS 以内に終わるコートをまとめて空ける
    const earliest = Math.min(...courtIds.map(id => courtBusyUntil.get(id)!));
    const freeIds = courtIds.filter(
      id => courtBusyUntil.get(id)! <= earliest + MIXED_WINDOW_MS
    );
    now = Math.max(now, ...freeIds.map(id => courtBusyUntil.get(id)!));

    for (const id of freeIds) courtOccupants.delete(id);

    const busyPlayerIds = new Set<string>();
    for (const ids of courtOccupants.values()) for (const id of ids) busyPlayerIds.add(id);

    const waiting = players.filter(p => !busyPlayerIds.has(p.id));
    if (waiting.length < 4 * freeIds.length) {
      // このベンチは全員が常時待機できる人数で回すため、通常ここには来ない
      if (waiting.length < 4) break;
    }

    let assignments;
    try {
      assignments = assignCourts(waiting, freeIds.length, history, {
        totalCourtCount: courtCount,
        targetCourtIds: freeIds,
        practiceStartTime: 0,
        allPlayers: players,
        useStayDurationPriority: true,
      });
    } catch {
      // insufficient-players など。計測不能な条件として捨てる
      return null;
    }
    if (assignments.length === 0) return null;

    for (const a of assignments) {
      const teamA = a.teamA.map(id => byId.get(id)!);
      const teamB = a.teamB.map(id => byId.get(id)!);
      const aWins = teamWins(teamA, teamB, n, rng);
      const duration = (6 + Math.floor(rng() * 4)) * 60_000; // 6〜9分
      const finishedAt = now + duration;

      history.push({
        id: `m${matchSeq++}`,
        courtId: a.courtId,
        teamA: a.teamA,
        teamB: a.teamB,
        scoreA: aWins ? 21 : 15,
        scoreB: aWins ? 15 : 21,
        startedAt: now,
        finishedAt,
        winner: aWins ? 'A' : 'B',
      });

      for (const p of [...teamA, ...teamB]) {
        p.gamesPlayed += 1;
        p.lastPlayedAt = finishedAt;
      }
      courtBusyUntil.set(a.courtId, finishedAt);
      courtOccupants.set(a.courtId, [...a.teamA, ...a.teamB]);
    }
  }

  // ---- 集計（すべて trueRank 基準）----
  const topCut = 3;
  const bottomStart = n - 3;
  let extremeMatches = 0;
  let gapSum = 0;
  const courtsSeen = new Map<string, Set<number>>();
  const matesSeen = new Map<string, Set<string>>();
  const pairCount = new Map<string, number>();
  for (const p of players) {
    courtsSeen.set(p.id, new Set());
    matesSeen.set(p.id, new Set());
  }

  for (const m of history) {
    const ids = [...m.teamA, ...m.teamB];
    const ranks = ids.map(id => byId.get(id)!.trueRank);
    if (ranks.some(r => r < topCut) && ranks.some(r => r >= bottomStart)) extremeMatches++;
    gapSum += Math.max(...ranks) - Math.min(...ranks);

    for (const id of ids) {
      courtsSeen.get(id)!.add(m.courtId);
      for (const other of ids) if (other !== id) matesSeen.get(id)!.add(other);
    }
    for (const team of [m.teamA, m.teamB]) {
      const key = [...team].sort().join('|');
      pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
    }
  }

  const games = players.map(p => p.gamesPlayed);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  return {
    separation: history.length ? extremeMatches / history.length : 0,
    trueGap: history.length ? gapSum / history.length : 0,
    gamesSpread: Math.max(...games) - Math.min(...games),
    rotation: mean(players.map(p => courtsSeen.get(p.id)!.size)),
    distinctMates: mean(players.map(p => matesSeen.get(p.id)!.size)),
    maxPairRepeat: Math.max(0, ...pairCount.values()),
    matches: history.length,
  };
}

// ---- 実行 ----
const SEEDS = Number(process.env.SEEDS ?? 150);
const ROUNDS = Number(process.env.ROUNDS ?? 15);
const NOISES = (process.env.NOISE ?? '0,4,8').split(',').map(Number);
const DEFAULT_CONDITIONS = '13x2,14x2,16x2,15x3,18x3,21x3';
const CONDITIONS = (process.env.CONDITIONS ?? DEFAULT_CONDITIONS)
  .split(',')
  .map(s => {
    const [n, c] = s.split('x').map(Number);
    return { n, courtCount: c };
  });

console.log(`SEEDS=${SEEDS} ROUNDS=${ROUNDS} NOISE=${NOISES.join(',')}`);
console.log(
  '  条件      NOISE  分離%   真実力差  試合数幅  回転     共演人数  ペア最大  試合数'
);
console.log('  ' + '-'.repeat(76));

for (const { n, courtCount } of CONDITIONS) {
  for (const noise of NOISES) {
    const results: RunResult[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = runOnce(n, courtCount, ROUNDS, noise, seed);
      if (r) results.push(r);
    }
    if (results.length === 0) {
      console.log(`  ${`${n}人${courtCount}C`.padEnd(9)} ${String(noise).padStart(5)}  (計測不能)`);
      continue;
    }
    const avg = (f: (r: RunResult) => number) =>
      results.reduce((s, r) => s + f(r), 0) / results.length;

    console.log(
      `  ${`${n}人${courtCount}C`.padEnd(9)} ${String(noise).padStart(5)}  ` +
        `${(avg(r => r.separation) * 100).toFixed(1).padStart(5)}  ` +
        `${avg(r => r.trueGap).toFixed(2).padStart(8)}  ` +
        `${avg(r => r.gamesSpread).toFixed(2).padStart(8)}  ` +
        `${avg(r => r.rotation).toFixed(2)}/${courtCount}  ` +
        `${avg(r => r.distinctMates).toFixed(2).padStart(8)}  ` +
        `${avg(r => r.maxPairRepeat).toFixed(2).padStart(8)}  ` +
        `${avg(r => r.matches).toFixed(0).padStart(6)}`
    );
  }
  console.log('');
}
