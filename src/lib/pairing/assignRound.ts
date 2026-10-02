/**
 * 目的関数ベースの1ラウンド同時配置エンジン。
 *
 * 採点は `objective.ts` の点数表（偏差何点分の悪さ）。ここは「どう選ぶか」だけを持つ。
 * 設計: docs/plans/2026-10-02-simplify-scoring.md（旧: 2026-08-05-pairing-goals-and-rewrite.md）
 *
 * ## ハード制約（違反数が少ない解を、点数より先に選ぶ）
 *
 * 1. 公平性の窓: 優先度順で「必要人数 + 余り × 比率」番目より後ろの人を出さない
 *    （後半均等化モードは比率を狭める）。窓の内側の公平性は点数側で、余りが少ないほど強い
 * 2. ペア希望「必ず」（strong）: 出るなら必ず味方 / 2人とも出るか2人とも控える
 * （旧ハード3「極端な実力差」は、余り人数に応じて効きが変わる重い点数 `extremePenalty` に変更。
 *  余りが `extremeRampEnd` 以上なら実質ハード、`extremeRampStart` 以下なら効かない）
 *
 * ## 選び方
 *
 * - 1コート: 窓内の候補から4人の全組み合わせ × チーム分け3通りを全列挙し、
 *   （違反数, 点数）が最小のものを採る（全滅でも違反最小→点数最小で必ず返す）
 * - 複数コート: 優先度上位から作った初期解を、決定的な局所探索（最急降下）で改善する
 *
 * `algorithm.ts` は import しない（循環参照防止）。
 */
import type { Player } from '../../types/player';
import type { CourtAssignment } from '../../types/court';
import {
  SCORE_TABLE,
  courtFixedPoints,
  splitPoints,
  courtSpan,
  fairnessPoints,
  extremeSurplusFactor,
  tripleRepeatPointsFor,
  looseAffinityPoints,
  type AffinityPair,
  type ScoreContext,
} from './objective';

/**
 * 強度「必ず」の希望ペア1組ぶんの入力。`docs/plans/2026-08-31-pair-preference.md`
 * 3d 参照（2026-09-01 に「2人一緒に出るか、2人とも控えるか」(b) を追加する仕様変更）。
 */
export interface StrongPair {
  a: string;
  b: string;
}

export interface AssignRoundParams {
  /** このラウンドの配置対象（待機者） */
  candidates: Player[];
  /** 埋めるコート */
  courtIds: number[];
  /** 偏差（`deviation.ts`）。当日のロースター全員分 */
  deviationById: Map<string, number>;
  /** 優先度スコア。小さいほど優先（試合数 ÷ 滞在分数）。-Infinity = 未出場（最優先） */
  priorityScoreOf: (p: Player) => number;
  /** 「1試合分」に相当する優先度スコアの差。公平性の点数の単位換算に使う。省略時 1 */
  oneGameDelta?: number;
  /** 3人組キー → 鮮度つき重み（`buildTripleWeights`）。省略時は3人以上一致の項なし */
  tripleWeights?: Map<string, number>;
  preferGenderMix: boolean;
  /** 男女比調整。false なら男女の点数が小さい値（`SCORE_TABLE.genderOff`）になる。既定 true */
  genderBalanceMode?: boolean;
  /** 後半均等化モード（公平性の窓を狭める） */
  lateBalanceMode?: boolean;
  /** ペア希望（normal。strong も含めてよい）。味方にならないと `pairPref` 点 */
  affinityPairs?: AffinityPair[];
  strongPairs?: StrongPair[];
  /** 連続出場数（`streak.ts`）。省略時は連続の項なし */
  streakById?: Map<string, number>;
}

const MAX_ITERATIONS = 200;

/** 公平性の窓の比率: 余った人数のこの割合まで、優先度順の後ろの人を出してよい */
const FAIRNESS_WINDOW_RATIO = 0.7;
const LATE_BALANCE_WINDOW_RATIO = 0.5;

const EPS = 1e-9;

type Slots = [string, string, string, string];

/** コート1つ（4人の集合）の最良のチーム分けと、その違反数・点数 */
interface CourtEval {
  slots: Slots;
  violations: number;
  points: number;
}

interface Evaluation {
  violations: number;
  points: number;
}

interface SearchState {
  courts: { courtId: number; slots: Slots }[];
  bench: string[];
}

const better = (a: Evaluation, b: Evaluation): number =>
  a.violations !== b.violations ? a.violations - b.violations : a.points - b.points;

export function assignRoundByObjective(params: AssignRoundParams): CourtAssignment[] {
  const { candidates, courtIds, deviationById, priorityScoreOf, preferGenderMix } = params;
  const lateBalanceMode = params.lateBalanceMode ?? false;
  const affinityPairs = params.affinityPairs ?? [];
  const strongPairs = params.strongPairs ?? [];
  const dev = (id: string): number => deviationById.get(id) ?? 50;

  // 1. 優先度順にソート。同点は偏差の高い順（当日序列は使わない。決定性のため最後は id 順）
  const sortedCandidates = [...candidates].sort((a, b) => {
    const diff = priorityScoreOf(a) - priorityScoreOf(b);
    if (diff !== 0) return diff;
    const d = dev(b.id) - dev(a.id);
    if (d !== 0) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const candidateCount = sortedCandidates.length;
  const priorityRankById = new Map(sortedCandidates.map((p, i) => [p.id, i] as const));

  // 試合数換算の優先度（小さいほど先に出すべき）。未出場（-Infinity）は最小の有限値より1試合ぶん先
  const oneGame = params.oneGameDelta && params.oneGameDelta > 0 ? params.oneGameDelta : 1;
  const finiteScores = sortedCandidates.map(priorityScoreOf).filter(Number.isFinite);
  const minFinite = finiteScores.length ? Math.min(...finiteScores) / oneGame : 0;
  const needById = new Map(
    sortedCandidates.map(p => {
      const s = priorityScoreOf(p);
      return [p.id, Number.isFinite(s) ? s / oneGame : minFinite - 1] as const;
    })
  );

  const ctx: ScoreContext = {
    deviationById,
    genderById: new Map(candidates.map(p => [p.id, p.gender] as const)),
    genderBalanceOn: params.genderBalanceMode ?? true,
    preferGenderMix,
    tripleWeights: params.tripleWeights ?? new Map(),
    streakById: params.streakById ?? new Map(),
    affinityPairs,
    needById,
  };
  const poolIds = new Set(candidates.map(p => p.id));

  const neededCount = Math.min(4 * courtIds.length, candidateCount - (candidateCount % 4));
  const usableCourtCount = Math.min(courtIds.length, Math.floor(candidateCount / 4));
  const usedCourtIds = courtIds.slice(0, usableCourtCount);
  if (usableCourtCount === 0) return [];

  // 公平性の窓（ハード1）
  const surplus = candidateCount - neededCount;
  ctx.tripleRepeatPoints = tripleRepeatPointsFor(surplus); // 余りに余裕がある日ほど3人以上一致を強く嫌う
  const windowLimit =
    neededCount + Math.ceil(surplus * (lateBalanceMode ? LATE_BALANCE_WINDOW_RATIO : FAIRNESS_WINDOW_RATIO));

  // コート単位の評価（4人の集合ごとにキャッシュ）。チーム分けは3通りから（違反, 点数）最小
  const courtCache = new Map<string, CourtEval>();
  const evalCourt = (ids: readonly string[]): CourtEval => {
    const sorted = [...ids].sort();
    const key = sorted.join(',');
    const hit = courtCache.get(key);
    if (hit) return hit;
    // 偏差の高い順に a,b,c,d とし、[a+d / b+c][a+c / b+d][a+b / c+d] の3通り
    const [a, b, c, d] = [...ids].sort((x, y) => dev(y) - dev(x) || (x < y ? -1 : x > y ? 1 : 0));
    const options: Slots[] = [
      [a, d, b, c],
      [a, c, b, d],
      [a, b, c, d],
    ];
    const fixed = courtFixedPoints(ids, ctx);
    const fixedTotal = fixed.span + fixed.triple + fixed.streak;
    let best: CourtEval | null = null;
    for (const slots of options) {
      // 「必ず」ペアが同コートで敵になる分割は違反
      let violations = 0;
      for (const { a: pa, b: pb } of strongPairs) {
        const inA = (id: string) => slots[0] === id || slots[1] === id;
        const inB = (id: string) => slots[2] === id || slots[3] === id;
        if ((inA(pa) && inB(pb)) || (inB(pa) && inA(pb))) violations++;
      }
      const split = splitPoints([slots[0], slots[1]], [slots[2], slots[3]], ctx);
      const points = fixedTotal + split.teamDiff + split.gender + split.pairEnemy;
      const cand: CourtEval = { slots, violations, points };
      if (!best || better(cand, best) < -EPS) best = cand;
    }
    const result = best!;
    // 極端な実力差。分割に依らないので最後に足す（「必ず」ペア2人の間は除く）
    const rawSpan = courtSpan(ids, deviationById, strongPairs);
    if (rawSpan >= SCORE_TABLE.extremeSpan) {
      result.points +=
        extremeSurplusFactor(surplus) *
        (SCORE_TABLE.extremePenalty + SCORE_TABLE.extremePerPoint * (rawSpan - SCORE_TABLE.extremeSpan));
    }
    courtCache.set(key, result);
    return result;
  };

  const evaluate = (courts: readonly Slots[]): Evaluation => {
    let violations = 0;
    let points = 0;
    const courtIdOf = new Map<string, number>();
    const partnerOf = new Map<string, string>();
    const selected: string[] = [];
    courts.forEach((slots, idx) => {
      const ce = evalCourt(slots);
      violations += ce.violations;
      points += ce.points;
      const [a, b, c, d] = ce.slots;
      for (const id of ce.slots) {
        courtIdOf.set(id, idx);
        selected.push(id);
      }
      partnerOf.set(a, b);
      partnerOf.set(b, a);
      partnerOf.set(c, d);
      partnerOf.set(d, c);
    });
    // ペア「必ず」(a) 同コートなら味方（分割側で数え済み）/ (b) 2人一緒に出るか2人とも控える / 別コートは違反
    for (const { a, b } of strongPairs) {
      const ca = courtIdOf.get(a);
      const cb = courtIdOf.get(b);
      if ((ca === undefined) !== (cb === undefined)) violations++;
      else if (ca !== undefined && ca !== cb) violations++;
    }
    // 公平性の窓（ハード1）。窓の外の人を1人出すごとに1違反
    if (windowLimit < candidateCount) {
      for (const id of selected) if ((priorityRankById.get(id) ?? 0) >= windowLimit) violations++;
    }
    const selectedSet = new Set(selected);
    points += fairnessPoints(
      selected,
      sortedCandidates.filter(p => !selectedSet.has(p.id)).map(p => p.id),
      needById,
      lateBalanceMode,
      surplus
    );
    if (affinityPairs.length > 0) {
      // 同コートで味方でも敵でもない（別コート・ベンチ）。同コートの敵は分割の点数に入っている
      points += looseAffinityPoints(courtIdOf, poolIds, affinityPairs);
    }
    return { violations, points };
  };

  let finalSlots: Slots[];

  if (usedCourtIds.length === 1) {
    // 2a. 1コート: 窓内の候補から4人の全組み合わせを全列挙（チーム分けは evalCourt が3通りを見る）
    const pool = sortedCandidates.slice(0, Math.max(4, Math.min(windowLimit, candidateCount))).map(p => p.id);
    let bestSlots: Slots | null = null;
    let bestEval: Evaluation | null = null;
    for (let i = 0; i < pool.length - 3; i++) {
      for (let j = i + 1; j < pool.length - 2; j++) {
        for (let k = j + 1; k < pool.length - 1; k++) {
          for (let l = k + 1; l < pool.length; l++) {
            const four: Slots = [pool[i], pool[j], pool[k], pool[l]];
            const ev = evaluate([four]);
            if (!bestEval || better(ev, bestEval) < -EPS) {
              bestEval = ev;
              bestSlots = evalCourt(four).slots;
            }
          }
        }
      }
    }
    finalSlots = [bestSlots!];
  } else {
    // 2b. 複数コート: 優先度上位 neededCount 人（「必ず」ペアは窓の内側なら2人セットで）を
    // 偏差順に4人ずつ区切った初期解 → 局所探索。
    // 近傍は1人ずつの入れ替えなので、「必ず」ペアの (a)(b) は2手がかりで直せない場合がある。
    // 初期解でペアを同じコートに置いておく（直せなければ違反として残り、探索が改善する）
    const partnerOf = new Map<string, string>();
    for (const { a, b } of strongPairs) {
      partnerOf.set(a, b);
      partnerOf.set(b, a);
    }
    const chosen: string[] = [];
    const chosenSet = new Set<string>();
    for (const c of sortedCandidates) {
      if (chosen.length >= neededCount) break;
      if (chosenSet.has(c.id)) continue;
      const mate = partnerOf.get(c.id);
      if (mate === undefined) {
        chosen.push(c.id);
        chosenSet.add(c.id);
      } else if (
        !chosenSet.has(mate) &&
        (priorityRankById.get(mate) ?? Infinity) < windowLimit &&
        chosen.length + 2 <= neededCount
      ) {
        chosen.push(c.id, mate);
        chosenSet.add(c.id);
        chosenSet.add(mate);
      }
    }
    for (const c of sortedCandidates) {
      if (chosen.length >= neededCount) break;
      if (!chosenSet.has(c.id)) {
        chosen.push(c.id);
        chosenSet.add(c.id);
      }
    }
    // 単位（ペアは2人で1単位）を偏差順に並べ、ペアが区切りで割れないように4人ずつ詰める
    const units: string[][] = [];
    const unitSeen = new Set<string>();
    for (const id of chosen) {
      if (unitSeen.has(id)) continue;
      const mate = partnerOf.get(id);
      if (mate !== undefined && chosenSet.has(mate)) {
        units.push([id, mate]);
        unitSeen.add(id);
        unitSeen.add(mate);
      } else {
        units.push([id]);
        unitSeen.add(id);
      }
    }
    const unitDev = (u: string[]) => u.reduce((sum, id) => sum + dev(id), 0) / u.length;
    units.sort((x, y) => unitDev(y) - unitDev(x) || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
    const blocks: string[][] = usedCourtIds.map(() => []);
    let bi = 0;
    while (units.length > 0) {
      while (bi < blocks.length - 1 && blocks[bi].length >= 4) bi++;
      const room = 4 - blocks[bi].length;
      let k = units.findIndex(u => u.length <= room);
      if (k < 0) k = 0;
      blocks[bi].push(...units.splice(k, 1)[0]);
    }
    const selected = blocks.flat();
    let state: SearchState = {
      courts: usedCourtIds.map((courtId, i) => ({
        courtId,
        slots: evalCourt(blocks[i]).slots,
      })),
      bench: sortedCandidates
        .map(p => p.id)
        .filter(id => !selected.includes(id))
        .sort(),
    };
    const evalState = (s: SearchState) => evaluate(s.courts.map(c => c.slots));
    const keyOf = (s: SearchState) =>
      s.courts.map(c => `${c.courtId}:${[...c.slots].sort().join(',')}`).join('|');

    function* neighbors(s: SearchState): Generator<SearchState> {
      const cs = [...s.courts].sort((a, b) => a.courtId - b.courtId);
      const make = (): SearchState => ({
        courts: s.courts.map(c => ({ courtId: c.courtId, slots: [...c.slots] as Slots })),
        bench: [...s.bench],
      });
      const norm = (n: SearchState): SearchState => {
        for (const c of n.courts) c.slots = evalCourt(c.slots).slots;
        return n;
      };
      // (a) 異なるコートの出場者2人を交換
      for (let i = 0; i < cs.length; i++) {
        for (let j = i + 1; j < cs.length; j++) {
          for (let si = 0; si < 4; si++) {
            for (let sj = 0; sj < 4; sj++) {
              const n = make();
              const ci = n.courts.find(c => c.courtId === cs[i].courtId)!;
              const cj = n.courts.find(c => c.courtId === cs[j].courtId)!;
              [ci.slots[si], cj.slots[sj]] = [cj.slots[sj], ci.slots[si]];
              yield norm(n);
            }
          }
        }
      }
      // (b) 出場者1人と控え1人を交換
      for (const court of cs) {
        for (let slot = 0; slot < 4; slot++) {
          for (const benchId of s.bench) {
            const n = make();
            const nc = n.courts.find(c => c.courtId === court.courtId)!;
            const bi = n.bench.indexOf(benchId);
            const out = nc.slots[slot];
            nc.slots[slot] = benchId;
            n.bench[bi] = out;
            n.bench.sort();
            yield norm(n);
          }
        }
      }
    }

    let current = evalState(state);
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      let bestN: SearchState | null = null;
      let bestEval: Evaluation | null = null;
      let bestKey = '';
      for (const n of neighbors(state)) {
        const ev = evalState(n);
        if (bestEval === null) {
          bestN = n; bestEval = ev; bestKey = keyOf(n);
          continue;
        }
        const cmp = better(ev, bestEval);
        if (cmp < -EPS) {
          bestN = n; bestEval = ev; bestKey = keyOf(n);
        } else if (Math.abs(cmp) <= EPS) {
          const key = keyOf(n);
          if (key < bestKey) { bestN = n; bestEval = ev; bestKey = key; }
        }
      }
      if (!bestN || !bestEval) break;
      if (better(bestEval, current) >= -EPS) break; // 改善なし
      state = bestN;
      current = bestEval;
    }
    const byId = new Map(state.courts.map(c => [c.courtId, c.slots] as const));
    finalSlots = usedCourtIds.map(id => byId.get(id)!);
  }

  return usedCourtIds.map((courtId, i) => ({
    courtId,
    teamA: [finalSlots[i][0], finalSlots[i][1]],
    teamB: [finalSlots[i][2], finalSlots[i][3]],
  }));
}
