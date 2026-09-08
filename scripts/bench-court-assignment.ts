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
 *
 * # ペア希望（affinity）の計測。docs/plans/2026-08-31-pair-preference.md 6. 参照
 * PREF_PAIRS=1 npx tsx scripts/bench-court-assignment.ts    # 希望ペアを1組登録
 * PREF_PAIRS=3 AFFINITY_WEIGHT=1.6 npx tsx scripts/bench-court-assignment.ts
 *
 * # 目的8 recency（連続出場を少し嫌う）の重み振り。
 * # docs/plans/2026-09-08-recency-penalty.md 参照
 * ENGINE=objective SEEDS=30 NOISE=4 CONDITIONS=21x3 ROUNDS=13 \
 *   RECENCY_WEIGHT=0.4 npx tsx scripts/bench-court-assignment.ts
 * ```
 *
 * アルゴリズム変更の効果を見るには、変更前後で同じ引数で実行して出力を比較する。
 * シードが同じなら人員構成・勝敗の乱数列は完全に再現される。
 *
 * ## ペア希望（`PREF_PAIRS` / `AFFINITY_WEIGHT`）
 *
 * `PREF_PAIRS=N`（既定0）で、ロースターからランダムに N 組（シード固定・決定的）
 * `strength: 'normal'` の希望ペアを登録した状態を計測する。`AFFINITY_WEIGHT=x` で
 * `src/lib/pairing/objective.ts` の `DEFAULT_WEIGHTS.affinity` をこのプロセス内だけ
 * 上書きする（bench 専用。本番の既定値は変わらない）。`PREF_PAIRS>0` のときのみ
 * 出力末尾に**成立率%**（希望ペアの実績/機会の平均。100% が `targetRatio=1.0` 相当、
 * 50% が `normal` の目標）と**リーク**（希望ペア当事者の試合数−全体中央値の平均。
 * 0 に近いほど「ペア希望で試合が増えていない」）が追加される。
 */
import { assignCourts } from '../src/lib/algorithm';
import { DEFAULT_WEIGHTS } from '../src/lib/pairing/objective';
import { median } from '../src/lib/median';
import type { Player } from '../src/types/player';
import type { Match } from '../src/types/match';
import type { PairPreference } from '../src/types/pairPreference';

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
      // 表示序列の上位ほど高レート。buildInitialOrder は rating > 0 を要求する。
      // TIES=<n> を渡すとレートを n 段階に量子化し、同レートの人を作る
      // （社会人サークルでは同レートがまとまるのが普通で、既定の全員別レートは
      //  同点順位の扱いを一切テストできない）。
      rating: TIE_LEVELS > 0
        ? 40 - Math.floor((displayIndex * TIE_LEVELS) / n) * 0.8
        : 40 - displayIndex * 0.8,
      gender: rng() < 0.45 ? 'F' : 'M',
      isResting: false,
      gamesPlayed: 0,
      lastPlayedAt: 0,
      activatedAt: 0,
      // #292 以降、滞在時間の起点は「会費・名簿の両方が完了した時刻」。
      // 未完了だと滞在時間ゼロ扱い（下限5分）になり、滞在時間モードが実質
      // 無効になってしまうため、ベンチでは全員完了済みとして扱う。
      operationStatus: { payment: true, roster: true, checkin: true },
      opsCompletedAt: 0,
      trueRank: entry.trueRank,
      joinAt: 0,
    });
  });
  return players;
}

/** ペアキー（`algorithm.ts` の `pairKey` と同じ規則: 2人の ID を昇順で連結） */
function pairKeyBench(a: string, b: string): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

/**
 * 希望ペアを `count` 組、ロースターからランダムに選ぶ（シード固定・決定的）。
 * 全員 `strength: 'normal'` で登録する。組同士は人が重複しない（2*count 人を
 * 一度シャッフルして先頭から2人ずつ組にする）。`count` がロースター人数の半分を
 * 超える場合は選べるだけ選ぶ（3c: 実用上の推奨は1〜3組なのでベンチも1〜6組しか
 * 振らない想定だが、小規模ロースターで安全側に倒す）。
 */
function pickPairPreferences(
  players: BenchPlayer[],
  count: number,
  rng: () => number
): PairPreference[] {
  if (count <= 0) return [];
  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const maxPairs = Math.min(count, Math.floor(shuffled.length / 2));
  const prefs: PairPreference[] = [];
  for (let i = 0; i < maxPairs; i++) {
    prefs.push({
      id: `pref${i}`,
      playerIds: [shuffled[i * 2].id, shuffled[i * 2 + 1].id],
      strength: 'normal',
      createdAt: 0,
    });
  }
  return prefs;
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
  // 目的2 の補助指標（docs/plans/2026-09-08-recency-penalty.md）。
  // maxIdle（最大）はプール人数（21人3コートなら平均間隔4.2試合）とセッション
  // 末尾の裾に支配されてしまい、「空き1〜2で回り続ける人と11試合待つ人の落差」
  // という体感を測れない。そこで次の3つを併記する。
  backToBackRate: number;  // 出場間隔のうち「空き1試合以下」が占める割合（低いほど良い）
  idleSd: number;          // 出場間隔の標準偏差（＝落差そのもの。低いほど良い）
  maxIdleMid: number;      // 末尾の裾を除いた「途中の空き」の最大（低いほど良い）
  // 目的3: 大きく実力の離れたメンバーを同居させない
  wideGapRate: number;     // trueRank の幅が閾値以上だった試合の割合（低いほど良い）
  regTopBottomRate: number; // 登録レートの上位1/3 × 下位1/3 が同居した試合の割合
  carryRate: number;        // コート内の登録最上位が最下位と同じチームになった割合
  overratedWinRate: number; // 「登録が実力より 1/3 以上高い人」の勝率（-1 = 該当者なし）
  trueGap: number;         // 4人の trueRank の最大−最小の平均（低いほど良い）
  // 目的4: 競る試合になる
  closeness: number;       // |真の勝率 − 0.5| の平均（低いほど競っている）
  // 目的5: 性別構成が偏らない
  genderSkewRate: number;  // 3-1 になった試合の割合（低いほど良い）
  winRateSd: number;       // 勝率の標準偏差（低いほど全員が5割に近い）
  mvfRate: number;         // 目的5b: 男女戦（男男 vs 女女）の割合
  gamesByTrueRank: number[]; // 実力順位ごとの試合数（序列の端が損をしていないか）
  lateRatio: number;       // 遅参加者の「在席比例に対する倍率」（1.0 が理想）
  earlyRatio: number;      // 最初から居る人の同上
  // 目的6: 顔ぶれが繰り返されない
  maxMateShare: number;    // 最多相手が自分の試合に占める割合の平均（低いほど良い）
  distinctMates: number;   // 1人あたりの異なる共演相手数の平均（高いほど良い）
  // 目的7: ペア希望（affinity）。docs/plans/2026-08-31-pair-preference.md 6.
  // 希望ペア成立率 = 実績(味方だった回数)/機会(min(gamesPlayed)) の平均。NaN = 対象外
  prefFulfillRate: number;
  // 公平性リーク = 希望ペア当事者の試合数 − 全体中央値 の平均（負値もあり得る）。NaN = 対象外
  prefFairnessLeak: number;
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

  // ペア希望（PREF_PAIRS 組。makeRoster が消費した続きの rng で選ぶので決定的）
  const pairPreferences = pickPairPreferences(players, PREF_PAIRS, rng);
  // 希望ペア成立率の算出用: pairKey → 味方だった回数（session 全体の累計）
  const partnerCounts = new Map<string, number>();

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
      p.opsCompletedAt = joinAt;
    }
  }

  const targetMatches = rounds * courtCount;
  let now = 0;
  let matchSeq = 0;
  // 進行中の試合。**本番の `matchHistory` に入るのは終了した試合だけ**
  // （`gameOperations.ts` の `computeFinishAndContinue` が終了時に append する）
  // ので、bench でも配置時ではなくここに溜め、終了時刻を過ぎたものだけを
  // `history` へ移す。配置時に push していた頃は、進行中（＝候補ですらない人）の
  // 試合が履歴の末尾 courtCount 件を占めており、履歴の末尾からの距離を見る
  // ロジック（目的8 `recency` / `isRecentDuplicate` / ハシゴ式）が本番と
  // 別物の入力を見ていた。docs/plans/2026-09-08-recency-penalty.md
  const pending: Match[] = [];
  /** finishedAt <= t の試合を finishedAt 昇順で history へ移す（本番の終了順 append と同じ） */
  const flushFinished = (t: number) => {
    const done: Match[] = [];
    const remain: Match[] = [];
    for (const m of pending) (m.finishedAt <= t ? done : remain).push(m);
    if (done.length === 0) return;
    done.sort((a, b) => a.finishedAt - b.finishedAt); // 同時刻は生成順（安定ソート）
    history.push(...done);
    pending.length = 0;
    pending.push(...remain);
  };

  // ループ条件は「作った試合数」で数える。history は終了ぶんしか増えないため、
  // ここを history.length にすると進行中のぶんだけ余計に試合を作ってしまう。
  while (matchSeq < targetMatches) {
    // 最も早く空くコートを起点に、MIXED_WINDOW_MS 以内に終わるコートをまとめて空ける
    const earliest = Math.min(...courtIds.map(id => courtBusyUntil.get(id)!));
    const freeIds = courtIds.filter(
      id => courtBusyUntil.get(id)! <= earliest + MIXED_WINDOW_MS
    );
    now = Math.max(now, ...freeIds.map(id => courtBusyUntil.get(id)!));
    simClock = now; // 滞在時間が「練習開始(0)からの経過」になるよう擬似時計を進める

    // 次の配置を組む前に、この時点で終わっている試合を履歴へ移す（本番と同じ順序）
    flushFinished(now);

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
        pairPreferences,
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

      // 配置＝出場確定なので gamesPlayed / lastPlayedAt / partnerCounts の更新は
      // 従来どおりこの場で行う（本番も配置時に確定する）。履歴への反映だけが
      // 終了時に遅れる。
      pending.push({
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
      if (pairPreferences.length > 0) {
        const incPartner = (x: string, y: string) => {
          const k = pairKeyBench(x, y);
          partnerCounts.set(k, (partnerCounts.get(k) ?? 0) + 1);
        };
        incPartner(a.teamA[0], a.teamA[1]);
        incPartner(a.teamB[0], a.teamB[1]);
      }
      courtBusyUntil.set(a.courtId, finishedAt);
      courtOccupants.set(a.courtId, [...a.teamA, ...a.teamB]);
    }
  }

  // 最後まで残った進行中の試合も集計対象に入れる（終了順で末尾に積む）
  flushFinished(Infinity);

  // ---- 集計（実力の評価はすべて trueRank 基準）----
  // 目的3 の閾値。plan で採用した B 案（順位差が全体の 2/3 以上なら「大きく離れている」）
  const wideGapThreshold = Math.ceil((n * 2) / 3);
  // 登録レート（rating 降順）の順位。アプリに入っている序列そのもの。
  const regRankById = new Map(
    [...players].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .map((p, i) => [p.id, i] as const)
  );
  const regThird = Math.floor(n / 3);

  let wideGapMatches = 0;
  let regTopBottomMatches = 0;
  let carryMatches = 0;
  let gapSum = 0;
  let closenessSum = 0;
  let genderSkewMatches = 0;
  const winsById = new Map<string, number>(players.map(p => [p.id, 0]));
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

    // 登録レート（アプリに入っている序列）の上位1/3 × 下位1/3 の同居。
    // 幅広% は trueRank 基準なので、「登録レート的に一番上と一番下」が混ざって
    // いるかは別に数える必要がある。
    const regs = ids.map(id => regRankById.get(id)!);
    if (regs.some(r => r < regThird) && regs.some(r => r >= n - regThird)) {
      regTopBottomMatches++;
    }
    // コート内の最上位が最下位と組まされている（＝一番強い人が一番弱い人を背負う）。
    // competitive は順位和を釣り合わせるため常に (r1+r4) vs (r2+r3) を選ぶので、
    // コートに幅があるほどこれが起きる。4人ランダムなら 1/3。
    {
      const sorted = [...ids].sort((a, b) => regRankById.get(a)! - regRankById.get(b)!);
      const hi = sorted[0], lo = sorted[3];
      if ((m.teamA.includes(hi) && m.teamA.includes(lo)) ||
          (m.teamB.includes(hi) && m.teamB.includes(lo))) carryMatches++;
    }

    // 目的4: 真の実力から見た勝率が 0.5 からどれだけ離れているか
    const diff = strength(m.teamA.map(id => byId.get(id)!)) -
      strength(m.teamB.map(id => byId.get(id)!));
    closenessSum += Math.abs(1 / (1 + Math.pow(10, -diff / 8)) - 0.5);

    for (const id of (m.winner === 'A' ? m.teamA : m.teamB)) {
      winsById.set(id, (winsById.get(id) ?? 0) + 1);
    }

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
  //
  // あわせて「出場と出場の間の空き」（＝末尾の裾を含まない、実際に待って次に
  // 出られた間隔）を全員分プールし、連投率・標準偏差・途中の最大を出す。
  // maxIdle だけだと分布の裾しか見えない（内訳の実測は plan の計測結果を参照）。
  let maxIdle = 0;
  let maxIdleMid = 0;
  const idleGaps: number[] = [];
  for (const p of players) {
    const idxs = appearances.get(p.id)!;
    let prev = -1;
    for (const idx of idxs) {
      const gap = idx - prev - 1;
      maxIdle = Math.max(maxIdle, gap);
      if (prev >= 0) {
        // 初出場までの空きは「待ち」ではない（まだ1試合も出ていないだけ）ので、
        // 間隔の統計には入れない
        maxIdleMid = Math.max(maxIdleMid, gap);
        idleGaps.push(gap);
      }
      prev = idx;
    }
    maxIdle = Math.max(maxIdle, history.length - prev - 1);
  }
  const idleMean = idleGaps.length
    ? idleGaps.reduce((a, b) => a + b, 0) / idleGaps.length
    : 0;
  const idleSd = idleGaps.length
    ? Math.sqrt(
        idleGaps.reduce((a, b) => a + (b - idleMean) ** 2, 0) / idleGaps.length
      )
    : 0;
  // 連投率: 「空き1試合以下」＝ ほぼ休まずに次の試合へ入った割合
  const backToBackRate = idleGaps.length
    ? idleGaps.filter(g => g <= 1).length / idleGaps.length
    : 0;

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

  // 勝率のばらつき（ハンデ装置＝ハシゴ式の効果を測る指標。低いほど勝率が均等）
  const winRates = players.filter(p => p.gamesPlayed > 0)
    .map(p => (winsById.get(p.id) ?? 0) / p.gamesPlayed);
  const wrMean = winRates.reduce((a, b) => a + b, 0) / winRates.length;
  const winRateSd = Math.sqrt(
    winRates.reduce((a, b) => a + (b - wrMean) ** 2, 0) / winRates.length
  );

  const games = players.map(p => p.gamesPlayed);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  // 目的7: ペア希望（affinity）。docs/plans/2026-08-31-pair-preference.md 6.
  //   成立率 = 実績(partnerCounts) / 機会(min(gamesPlayed)) をペアごとに求め、
  //            登録した全ペアで平均する
  //   リーク = 希望ペア当事者（登録した全ペアのユニークな2N人）それぞれの
  //            試合数 − 全体中央値を求め、平均する
  let prefFulfillRate = NaN;
  let prefFairnessLeak = NaN;
  if (pairPreferences.length > 0) {
    const overallMedian = median(games);
    const rates: number[] = [];
    const participantIds = new Set<string>();
    for (const pref of pairPreferences) {
      const [pa, pb] = pref.playerIds;
      const playerA = byId.get(pa)!;
      const playerB = byId.get(pb)!;
      const opportunity = Math.min(playerA.gamesPlayed, playerB.gamesPlayed);
      const actual = partnerCounts.get(pairKeyBench(pa, pb)) ?? 0;
      rates.push(actual / Math.max(1, opportunity));
      participantIds.add(pa);
      participantIds.add(pb);
    }
    prefFulfillRate = mean(rates);
    prefFairnessLeak = mean(
      [...participantIds].map(id => byId.get(id)!.gamesPlayed - overallMedian)
    );
  }

  return {
    gamesSpread: Math.max(...games) - Math.min(...games),
    maxIdle,
    backToBackRate,
    idleSd,
    maxIdleMid,
    wideGapRate: history.length ? wideGapMatches / history.length : 0,
    overratedWinRate: (() => {
      // 登録序列が実力より大きく上（＝過大評価）の人が、実力相応の帯まで降りて
      // たまに勝てているか。安全網を登録序列で張ると降りられず勝率が落ちる。
      const targets = players.filter(
        p => p.trueRank - (regRankById.get(p.id) ?? 0) >= n / 4
      );
      if (targets.length === 0) return -1;
      let w = 0, g = 0;
      for (const p of targets) {
        w += winsById.get(p.id) ?? 0;
        g += games[players.indexOf(p)] ?? 0;
      }
      return g > 0 ? w / g : -1;
    })(),
    regTopBottomRate: history.length ? regTopBottomMatches / history.length : 0,
    carryRate: history.length ? carryMatches / history.length : 0,
    trueGap: history.length ? gapSum / history.length : 0,
    closeness: history.length ? closenessSum / history.length : 0,
    genderSkewRate: history.length ? genderSkewMatches / history.length : 0,
    winRateSd,
    mvfRate: history.length ? mvfMatches / history.length : 0,
    gamesByTrueRank,
    lateRatio: meanOf(lateRatios),
    earlyRatio: meanOf(earlyRatios),
    maxMateShare: shares.length ? mean(shares) : 0,
    distinctMates: mean(players.map(p => matesSeen.get(p.id)!.size)),
    rotation: mean(players.map(p => courtsSeen.get(p.id)!.size)),
    matches: history.length,
    prefFulfillRate,
    prefFairnessLeak,
  };
}

// ---- 実行 ----
const SEEDS = Number(process.env.SEEDS ?? 150);
const TIE_LEVELS = Number(process.env.TIES ?? 0);
const ROUNDS = Number(process.env.ROUNDS ?? 15);
/** 遅参加させる人数（0 = 全員最初から在席）。例: LATE_JOIN=3 */
const LATE_JOIN = Number(process.env.LATE_JOIN ?? 0);
const NOISES = (process.env.NOISE ?? '0,4,8').split(',').map(Number);
/**
 * ペア希望（`docs/plans/2026-08-31-pair-preference.md`）を N 組ランダム登録する。
 * 既定 0（＝希望なし。既存の全指標に影響しない）。N = 1 / 3 / 6 を測る想定。
 */
const PREF_PAIRS = Number(process.env.PREF_PAIRS ?? 0);
/**
 * `AFFINITY_WEIGHT` の重みをこのプロセス内だけ上書きする（bench 専用。本番の
 * `DEFAULT_WEIGHTS.affinity` の既定値は変えない）。未指定ならリポジトリの既定値のまま。
 */
if (process.env.AFFINITY_WEIGHT !== undefined) {
  DEFAULT_WEIGHTS.affinity = Number(process.env.AFFINITY_WEIGHT);
}
/**
 * `recency`（目的8: 連続出場を少し嫌う）の重みをこのプロセス内だけ上書きする
 * （bench 専用。本番の `DEFAULT_WEIGHTS.recency` の既定値は変えない）。
 * 未指定ならリポジトリの既定値のまま。
 * `docs/plans/2026-09-08-recency-penalty.md` の「決め方（bench）」で使う。
 */
if (process.env.RECENCY_WEIGHT !== undefined) {
  DEFAULT_WEIGHTS.recency = Number(process.env.RECENCY_WEIGHT);
}
const DEFAULT_CONDITIONS = '13x2,14x2,16x2,15x3,18x3,21x3,22x3,25x3';
const CONDITIONS = (process.env.CONDITIONS ?? DEFAULT_CONDITIONS)
  .split(',')
  .map(s => {
    const [n, c] = s.split('x').map(Number);
    return { n, courtCount: c };
  });

console.log(`SEEDS=${SEEDS} ROUNDS=${ROUNDS} NOISE=${NOISES.join(',')} ENGINE=${USE_OBJECTIVE_ENGINE ? 'objective' : 'legacy'}` +
  (PREF_PAIRS > 0 ? ` PREF_PAIRS=${PREF_PAIRS} AFFINITY_WEIGHT=${DEFAULT_WEIGHTS.affinity}` : '') +
  (process.env.RECENCY_WEIGHT !== undefined ? ` RECENCY_WEIGHT=${DEFAULT_WEIGHTS.recency}` : ''));
console.log('  指標は docs/plans/2026-08-05-pairing-goals-and-rewrite.md の目的1〜6に対応');
console.log('  幅広%=目的3 競り度=目的4 3-1%=目的5 男女戦%=目的5b 占有率%/共演=目的6 試合数幅=目的1 待ち=目的2');
console.log('  待ち途中=末尾の裾を除いた空きの最大 連投%=空き1試合以下の割合 待ちσ=空きの標準偏差（いずれも目的2の補助）');
console.log('  端中=序列の端1/3と中央1/3の平均試合数の差（負なら端が損をしている）');
if (LATE_JOIN > 0) console.log('  遅参加=在席時間に比例した期待値に対する倍率（1.00 が理想）');
if (PREF_PAIRS > 0) {
  console.log('  成立率%=目的7（ペア希望）= 実績(味方だった回数)/機会(min 試合数) の登録ペア平均');
  console.log('    （normal の目標は 50%。docs/plans/2026-08-31-pair-preference.md 6.）');
  console.log('  リーク=希望ペア当事者の試合数−全体中央値の平均（0 に近いほど試合数が公平）');
  if (!USE_OBJECTIVE_ENGINE) {
    console.log('');
    console.log(
      '  ⚠️  ENGINE=objective が指定されていません。ペア希望（affinity）は' +
        ' src/lib/pairing/ の新エンジンにしか実装されていないため、旧エンジンでは' +
        ' PREF_PAIRS を設定しても完全に無視され、成立率は必ず 0% になります。' +
        ' ENGINE=objective を付けて実行し直してください。'
    );
  }
}
console.log('  （共演のみ高いほど良い。他はすべて低いほど良い）');
console.log('');
console.log(
  '  条件      NOISE  幅広%  登録上下%  背負い%  過大勝率%  競り度  3-1%  男女戦%  端中   占有率%  共演   試合数幅  待ち  待ち途中  連投%  待ちσ  勝率SD%' +
    (LATE_JOIN > 0 ? '  遅参加' : '') +
    (PREF_PAIRS > 0 ? '  成立率%  リーク' : '')
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
        `${(avg(r => r.regTopBottomRate) * 100).toFixed(1).padStart(8)}  ` +
        `${(avg(r => r.carryRate) * 100).toFixed(1).padStart(6)}  ` +
        `${(() => {
          const vs = results.map(r => r.overratedWinRate).filter(v => v >= 0);
          return vs.length ? ((vs.reduce((a, b) => a + b, 0) / vs.length) * 100).toFixed(1) : '  --';
        })().padStart(8)}  ` +
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
        `${avg(r => r.maxIdle).toFixed(2).padStart(4)}  ` +
        `${avg(r => r.maxIdleMid).toFixed(2).padStart(6)}  ` +
        `${(avg(r => r.backToBackRate) * 100).toFixed(1).padStart(5)}  ` +
        `${avg(r => r.idleSd).toFixed(2).padStart(5)}` +
        `  ${(avg(r => r.winRateSd) * 100).toFixed(1)}` +
        (LATE_JOIN > 0 ? `   ${avg(r => r.lateRatio).toFixed(2)}倍` : '') +
        (PREF_PAIRS > 0
          ? `   ${(() => {
              const vs = results.map(r => r.prefFulfillRate).filter(v => !Number.isNaN(v));
              return vs.length ? ((vs.reduce((a, b) => a + b, 0) / vs.length) * 100).toFixed(1) : '--';
            })()}   ${(() => {
              const vs = results.map(r => r.prefFairnessLeak).filter(v => !Number.isNaN(v));
              return vs.length ? (vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(2) : '--';
            })()}`
          : '')
    );
  }
  console.log('');
}
