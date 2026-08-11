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

/**
 * 擬似時計。`calculatePriorityScore` / `computeOneGameDelta` は滞在時間の算出に
 * `Date.now()` を直接呼ぶため、実時刻のままだと同じシードでも実行ごとに結果が
 * 微妙にぶれる（優先度スコアとペナルティが僅差のとき順位が入れ替わる）。
 * シミュレーション上の時刻を返すよう差し替えて、計測を完全に決定的にする。
 */
let simClock = 0;
Date.now = () => simClock;

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
  /** 遅参加の到着時刻（0 = 最初から在席）。LATE_JOIN で設定 */
  joinAt: number;
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
      joinAt: 0,
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

/**
 * 指標は docs/plans/2026-08-05-pairing-goals-and-rewrite.md の「やりたいこと（6個）」に
 * 1目的1指標で対応させる。手段（帯分割やハシゴ式）の達成度ではなく目的を測る。
 */
interface RunResult {
  // 目的1: 出場機会が均等
  gamesSpread: number;     // 最多試合数 − 最少試合数（低いほど良い）
  // 目的2: 待ち時間が偏らない
  maxIdle: number;         // 自分が出ていない間に行われた試合数の最大（低いほど良い）
  // 目的3: 大きく実力の離れたメンバーを同居させない
  wideGapRate: number;     // trueRank の幅が閾値以上だった試合の割合（低いほど良い）
  trueGap: number;         // 4人の trueRank の最大−最小の平均（低いほど良い）
  // 目的4: 競る試合になる
  closeness: number;       // |真の勝率 − 0.5| の平均（低いほど競っている）
  // 目的5: 性別構成が偏らない
  genderSkewRate: number;  // 3-1 になった試合の割合（低いほど良い）
  mvfRate: number;         // 目的5b: 男女戦（男男 vs 女女）の割合
  gamesByTrueRank: number[]; // 実力順位ごとの試合数（序列の端が損をしていないか）
  lateRatio: number;       // 遅参加者の「在席比例に対する倍率」（1.0 が理想）
  earlyRatio: number;      // 最初から居る人の同上
  // 目的6: 顔ぶれが繰り返されない
  maxMateShare: number;    // 最多相手が自分の試合に占める割合の平均（低いほど良い）
  distinctMates: number;   // 1人あたりの異なる共演相手数の平均（高いほど良い）
  // 参考
  rotation: number;
  matches: number;
}

const MIXED_WINDOW_MS = 60_000; // これ以内に終わるコートは同時配置扱い

// ENGINE=objective で src/lib/pairing/assignRound.ts の新エンジンを使う。既定は既存エンジン。
const USE_OBJECTIVE_ENGINE = process.env.ENGINE === 'objective';

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

  // 遅参加: 序列の中央付近から LATE_JOIN 人を、練習の 40% 経過時点で合流させる。
  // 本番と同じ経路（isResting を解除し activatedAt に到着時刻を入れる）を再現する。
  if (LATE_JOIN > 0) {
    const joinAt = Math.floor(rounds * 8 * 60_000 * 0.4);
    const mid = Math.floor(players.length / 2);
    for (let k = 0; k < LATE_JOIN; k++) {
      const p = players[(mid + k) % players.length];
      p.isResting = true;
      p.joinAt = joinAt;
      p.activatedAt = joinAt;
    }
  }

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
    simClock = now; // 滞在時間が「練習開始(0)からの経過」になるよう擬似時計を進める

    for (const id of freeIds) courtOccupants.delete(id);

    for (const p of players) {
      if (p.isResting && now >= p.joinAt) p.isResting = false;
    }

    const busyPlayerIds = new Set<string>();
    for (const ids of courtOccupants.values()) for (const id of ids) busyPlayerIds.add(id);

    const waiting = players.filter(p => !busyPlayerIds.has(p.id) && !p.isResting);
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
        useObjectiveEngine: USE_OBJECTIVE_ENGINE,
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

  // ---- 集計（実力の評価はすべて trueRank 基準）----
  // 目的3 の閾値。plan で採用した B 案（順位差が全体の 2/3 以上なら「大きく離れている」）
  const wideGapThreshold = Math.ceil((n * 2) / 3);

  let wideGapMatches = 0;
  let gapSum = 0;
  let closenessSum = 0;
  let genderSkewMatches = 0;
  let twoTwoMatches = 0;
  let mvfMatches = 0;
  const gamesByTrueRank = new Array(n).fill(0);
  const courtsSeen = new Map<string, Set<number>>();
  const matesSeen = new Map<string, Set<string>>();
  // 「誰と何回顔を合わせたか」。最多相手の占有率（体感の "また同じ人" ）に使う
  const mateCounts = new Map<string, Map<string, number>>();
  // 出場した試合のインデックス。待ち時間（目的2）の算出に使う
  const appearances = new Map<string, number[]>();
  for (const p of players) {
    courtsSeen.set(p.id, new Set());
    matesSeen.set(p.id, new Set());
    mateCounts.set(p.id, new Map());
    appearances.set(p.id, []);
  }

  const strength = (t: BenchPlayer[]) => t.reduce((s, p) => s + (n - 1 - p.trueRank), 0);

  history.forEach((m, matchIndex) => {
    const ids = [...m.teamA, ...m.teamB];
    const ranks = ids.map(id => byId.get(id)!.trueRank);
    const gap = Math.max(...ranks) - Math.min(...ranks);
    gapSum += gap;
    if (gap >= wideGapThreshold) wideGapMatches++;

    // 目的4: 真の実力から見た勝率が 0.5 からどれだけ離れているか
    const diff = strength(m.teamA.map(id => byId.get(id)!)) -
      strength(m.teamB.map(id => byId.get(id)!));
    closenessSum += Math.abs(1 / (1 + Math.pow(10, -diff / 8)) - 0.5);

    // 目的5: 3-1 の性別構成
    const femaleCount = ids.filter(id => byId.get(id)!.gender === 'F').length;
    if (femaleCount === 1 || femaleCount === 3) genderSkewMatches++;

    // 目的5b: 2-2 のうち「男男 vs 女女」（男女戦）になった試合
    if (femaleCount === 2) {
      twoTwoMatches++;
      const femaleInA = m.teamA.filter(id => byId.get(id)!.gender === 'F').length;
      if (femaleInA !== 1) mvfMatches++;
    }

    for (const id of ids) {
      gamesByTrueRank[byId.get(id)!.trueRank]++;
      courtsSeen.get(id)!.add(m.courtId);
      appearances.get(id)!.push(matchIndex);
      const counts = mateCounts.get(id)!;
      for (const other of ids) {
        if (other === id) continue;
        matesSeen.get(id)!.add(other);
        counts.set(other, (counts.get(other) ?? 0) + 1);
      }
    }
  });

  // 目的2: 自分が出ていない間に行われた試合数の最大（セッション末尾の待ちも数える）
  let maxIdle = 0;
  for (const p of players) {
    const idxs = appearances.get(p.id)!;
    let prev = -1;
    for (const idx of idxs) {
      maxIdle = Math.max(maxIdle, idx - prev - 1);
      prev = idx;
    }
    maxIdle = Math.max(maxIdle, history.length - prev - 1);
  }

  // 目的6: 試合をした人だけを対象に「最多相手 / 自分の試合数」を平均する
  const shares = players
    .filter(p => p.gamesPlayed > 0)
    .map(p => {
      const counts = [...mateCounts.get(p.id)!.values()];
      return counts.length ? Math.max(...counts) / p.gamesPlayed : 0;
    });

  // 在席時間に比例した期待試合数との比。遅参加者が時間比例より多く出ていないか。
  const expected = new Map<string, number>(players.map(p => [p.id, 0]));
  for (const m of history) {
    const present = players.filter(p => m.startedAt >= p.joinAt);
    for (const p of present) expected.set(p.id, expected.get(p.id)! + 4 / present.length);
  }
  const ratioOf = (p: BenchPlayer) => p.gamesPlayed / Math.max(expected.get(p.id)!, 1e-9);
  const meanOf = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const lateRatios = players.filter(p => p.joinAt > 0).map(ratioOf);
  const earlyRatios = players.filter(p => p.joinAt === 0).map(ratioOf);

  const games = players.map(p => p.gamesPlayed);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  return {
    gamesSpread: Math.max(...games) - Math.min(...games),
    maxIdle,
    wideGapRate: history.length ? wideGapMatches / history.length : 0,
    trueGap: history.length ? gapSum / history.length : 0,
    closeness: history.length ? closenessSum / history.length : 0,
    genderSkewRate: history.length ? genderSkewMatches / history.length : 0,
    mvfRate: history.length ? mvfMatches / history.length : 0,
    gamesByTrueRank,
    lateRatio: meanOf(lateRatios),
    earlyRatio: meanOf(earlyRatios),
    maxMateShare: shares.length ? mean(shares) : 0,
    distinctMates: mean(players.map(p => matesSeen.get(p.id)!.size)),
    rotation: mean(players.map(p => courtsSeen.get(p.id)!.size)),
    matches: history.length,
  };
}

// ---- 実行 ----
const SEEDS = Number(process.env.SEEDS ?? 150);
const ROUNDS = Number(process.env.ROUNDS ?? 15);
/** 遅参加させる人数（0 = 全員最初から在席）。例: LATE_JOIN=3 */
const LATE_JOIN = Number(process.env.LATE_JOIN ?? 0);
const NOISES = (process.env.NOISE ?? '0,4,8').split(',').map(Number);
const DEFAULT_CONDITIONS = '13x2,14x2,16x2,15x3,18x3,21x3';
const CONDITIONS = (process.env.CONDITIONS ?? DEFAULT_CONDITIONS)
  .split(',')
  .map(s => {
    const [n, c] = s.split('x').map(Number);
    return { n, courtCount: c };
  });

console.log(`SEEDS=${SEEDS} ROUNDS=${ROUNDS} NOISE=${NOISES.join(',')} ENGINE=${USE_OBJECTIVE_ENGINE ? 'objective' : 'legacy'}`);
console.log('  指標は docs/plans/2026-08-05-pairing-goals-and-rewrite.md の目的1〜6に対応');
console.log('  幅広%=目的3 競り度=目的4 3-1%=目的5 男女戦%=目的5b 占有率%/共演=目的6 試合数幅=目的1 待ち=目的2');
console.log('  端中=序列の端1/3と中央1/3の平均試合数の差（負なら端が損をしている）');
if (LATE_JOIN > 0) console.log('  遅参加=在席時間に比例した期待値に対する倍率（1.00 が理想）');
console.log('  （共演のみ高いほど良い。他はすべて低いほど良い）');
console.log('');
console.log(
  '  条件      NOISE  幅広%  競り度  3-1%  男女戦%  端中   占有率%  共演   試合数幅  待ち' +
    (LATE_JOIN > 0 ? '  遅参加' : '')
);
console.log('  ' + '-'.repeat(72));

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
        `${(avg(r => r.wideGapRate) * 100).toFixed(1).padStart(5)}  ` +
        `${(avg(r => r.closeness) * 100).toFixed(1).padStart(6)}  ` +
        `${(avg(r => r.genderSkewRate) * 100).toFixed(1).padStart(4)}  ` +
        `${(avg(r => r.mvfRate) * 100).toFixed(1).padStart(5)}  ` +
        (() => {
          const len = results[0].gamesByTrueRank.length;
          const per = Array.from({ length: len }, (_, i) =>
            results.reduce((s, r) => s + r.gamesByTrueRank[i], 0) / results.length);
          const mid = (len - 1) / 2;
          const pick = (edge: boolean) =>
            per.filter((_, i) => (Math.abs(i - mid) >= len / 3) === edge);
          const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
          return `${(mean(pick(true)) - mean(pick(false))).toFixed(2).padStart(6)}  `;
        })() +
        `${(avg(r => r.maxMateShare) * 100).toFixed(1).padStart(7)}  ` +
        `${avg(r => r.distinctMates).toFixed(2).padStart(5)}  ` +
        `${avg(r => r.gamesSpread).toFixed(2).padStart(8)}  ` +
        `${avg(r => r.maxIdle).toFixed(2).padStart(4)}`
    );
  }
  console.log('');
}
