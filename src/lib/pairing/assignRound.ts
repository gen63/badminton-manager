/**
 * 目的関数ベースの1ラウンド同時配置エンジン。
 *
 * `docs/plans/2026-08-05-pairing-goals-and-rewrite.md` の新設計:
 *   ハード制約（順位差の閾値 / 直近の重複）→ 目的関数（6目的の重み付き合計）→
 *   局所探索（最急降下、乱数なしで決定的）。
 *
 * `algorithm.ts` の `selectBestFour` 等（既存の候補選出・修復パス群）とは独立に
 * 動く別モジュール。既存コードは import しない（`objective.ts` も同様）。
 */
import type { Player } from '../../types/player';
import type { CourtAssignment } from '../../types/court';
import {
  DEFAULT_WEIGHTS,
  computeObjectiveTerms,
  weightedObjective,
  type ObjectiveWeights,
  type CourtPlacement,
  type PairCounts,
} from './objective';

export interface AssignRoundParams {
  /** このラウンドの配置対象（待機者） */
  candidates: Player[];
  /** 埋めるコート */
  courtIds: number[];
  /** 実力の順位（`buildInitialOrder` 相当、0始まり） */
  rankById: Map<string, number>;
  rosterSize: number;
  /** 低いほど優先。algorithm.ts の calculatePriorityScore を呼び出し側が渡す */
  priorityScoreOf: (p: Player) => number;
  pairCounts: PairCounts;
  /** ペアのキー生成規則（呼び出し側と統一すること） */
  pairKeyOf: (a: string, b: string) => string;
  /** 直近試合との重複（ハード制約）。true なら不可 */
  isRecentDuplicate: (ids: string[]) => boolean;
  /** 順位差のハード制約。null なら制約なし（14人未満） */
  wideSpanThreshold: number | null;
  preferGenderMix: boolean;
  weights?: Partial<ObjectiveWeights>;
}

/** 局所探索の反復上限 */
const MAX_ITERATIONS = 200;

/** コート1つ分の内部状態。slots = [teamA0, teamA1, teamB0, teamB1] */
interface CourtState {
  courtId: number;
  slots: [string, string, string, string];
}

interface SearchState {
  courts: CourtState[];
  bench: string[];
}

interface Evaluation {
  violations: number;
  objective: number;
}

function courtMembers(court: CourtState): string[] {
  return court.slots;
}

function toPlacement(court: CourtState): CourtPlacement {
  return {
    courtId: court.courtId,
    teamA: [court.slots[0], court.slots[1]],
    teamB: [court.slots[2], court.slots[3]],
  };
}

function cloneState(state: SearchState): SearchState {
  return {
    courts: state.courts.map(c => ({ courtId: c.courtId, slots: [...c.slots] as CourtState['slots'] })),
    bench: [...state.bench],
  };
}

/** 状態を一意に表す文字列（同点タイブレーク用。プレイヤーID辞書順で決定的） */
function stateKey(state: SearchState): string {
  return state.courts
    .slice()
    .sort((a, b) => a.courtId - b.courtId)
    .map(c => {
      const teamA = [c.slots[0], c.slots[1]].sort();
      const teamB = [c.slots[2], c.slots[3]].sort();
      const [first, second] =
        teamA.join(',') <= teamB.join(',') ? [teamA, teamB] : [teamB, teamA];
      return `${c.courtId}:${first.join(',')}/${second.join(',')}`;
    })
    .join('|');
}

/** (violations, objective) の辞書式比較。負なら a が良い */
function compareEval(a: Evaluation, b: Evaluation): number {
  if (a.violations !== b.violations) return a.violations - b.violations;
  return a.objective - b.objective;
}

export function assignRoundByObjective(params: AssignRoundParams): CourtAssignment[] {
  const {
    candidates,
    courtIds,
    rankById,
    rosterSize,
    priorityScoreOf,
    pairCounts,
    pairKeyOf,
    isRecentDuplicate,
    wideSpanThreshold,
    preferGenderMix,
  } = params;

  const weights: ObjectiveWeights = { ...DEFAULT_WEIGHTS, ...params.weights };

  const genderById = new Map<string, 'M' | 'F' | undefined>(
    candidates.map(p => [p.id, p.gender] as const)
  );

  // 1. 優先度順にソート。
  //
  // 同点は**実力順位**で割る。滞在時間ベースの優先度は同時進行のラウンドで同点に
  // なりやすく、ここを ID の辞書順にすると実力順位と無関係な並びになって、
  // 「両端だけを選ぶ」ような歪んだ選出が起きる。既存エンジンはタイブレークを持たず
  // 入力順（＝序列順）で安定ソートされるので、実質的に順位順で割っており、
  // それに揃える。ID は順位が引き分けたときの最終手段としてのみ使う。
  const sortedCandidates = [...candidates].sort((a, b) => {
    const diff = priorityScoreOf(a) - priorityScoreOf(b);
    if (diff !== 0) return diff;
    const rankDiff = (rankById.get(a.id) ?? 0) - (rankById.get(b.id) ?? 0);
    if (rankDiff !== 0) return rankDiff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const candidateCount = sortedCandidates.length;
  const priorityRankById = new Map<string, number>(
    sortedCandidates.map((p, index) => [p.id, index] as const)
  );

  const neededCount = Math.min(4 * courtIds.length, candidateCount - (candidateCount % 4));
  const usableCourtCount = Math.min(courtIds.length, Math.floor(candidateCount / 4));
  const usedCourtIds = courtIds.slice(0, usableCourtCount);

  const selected = sortedCandidates.slice(0, neededCount);
  const bench = sortedCandidates.slice(neededCount).map(p => p.id).sort();

  // 2. 初期解の構築。
  //
  // `wideSpanThreshold` が null（14人未満で制約なし）の場合は、優先度順の先頭
  // 4×コート数人を実力順位で昇順ソートしてから先頭ブロックから順にコートへ
  // 割り当てる（各コートの順位幅を最小化する）。
  //
  // 制約がある場合は、コートを1面ずつ「制約を満たすように」貪欲に埋める:
  // まだ選ばれていない候補のうち最も優先度が高い人を1人目に置き、残り3人は
  // 優先度順に見て「そのコートに入れても順位差の制約を破らない」人を先頭から
  // 採る。足りない場合は制約を無視して優先度順に埋める（局所探索が後で改善する）。
  let initialCourts: CourtState[];
  if (wideSpanThreshold === null) {
    const rankSortedSelected = [...selected].sort((a, b) => {
      const rankA = rankById.get(a.id) ?? 0;
      const rankB = rankById.get(b.id) ?? 0;
      if (rankA !== rankB) return rankA - rankB;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    initialCourts = usedCourtIds.map((courtId, courtIndex) => {
      const four = rankSortedSelected.slice(courtIndex * 4, courtIndex * 4 + 4);
      return {
        courtId,
        slots: [four[0].id, four[1].id, four[2].id, four[3].id] as CourtState['slots'],
      };
    });
  } else {
    const threshold = wideSpanThreshold;
    const pool = [...sortedCandidates]; // 優先度順。消費した人を都度取り除く。
    initialCourts = usedCourtIds.map(courtId => {
      const chosenIndices: number[] = [0];
      const courtRanks: number[] = [rankById.get(pool[0].id) ?? 0];

      // 制約を満たす範囲で優先度順に3人追加。
      for (let i = 1; i < pool.length && chosenIndices.length < 4; i++) {
        const rank = rankById.get(pool[i].id) ?? 0;
        const gap = Math.max(...courtRanks, rank) - Math.min(...courtRanks, rank);
        if (gap < threshold) {
          chosenIndices.push(i);
          courtRanks.push(rank);
        }
      }

      // 制約を満たす人が足りない場合、優先度順に残りを埋める。
      for (let i = 1; i < pool.length && chosenIndices.length < 4; i++) {
        if (!chosenIndices.includes(i)) {
          chosenIndices.push(i);
        }
      }

      chosenIndices.sort((a, b) => a - b);
      const four = chosenIndices.map(i => pool[i]);
      for (let k = chosenIndices.length - 1; k >= 0; k--) {
        pool.splice(chosenIndices[k], 1);
      }

      return {
        courtId,
        slots: [four[0].id, four[1].id, four[2].id, four[3].id] as CourtState['slots'],
      };
    });
  }

  let state: SearchState = { courts: initialCourts, bench };

  const evaluate = (s: SearchState): Evaluation => {
    let violations = 0;
    const placements: CourtPlacement[] = s.courts.map(toPlacement);
    for (const court of s.courts) {
      const members = courtMembers(court);
      if (wideSpanThreshold !== null) {
        const ranks = members
          .map(id => rankById.get(id))
          .filter((r): r is number => r !== undefined);
        if (ranks.length === members.length) {
          const gap = Math.max(...ranks) - Math.min(...ranks);
          if (gap >= wideSpanThreshold) violations++;
        }
      }
      if (isRecentDuplicate(members)) violations++;
    }
    const terms = computeObjectiveTerms({
      courts: placements,
      benchIds: s.bench,
      priorityRankById,
      candidateCount,
      rankById,
      rosterSize,
      genderById,
      preferGenderMix,
      pairCounts,
      pairKeyOf,
    });
    return { violations, objective: weightedObjective(terms, weights) };
  };

  // 3. 近傍生成（決定的な順序で列挙する）
  function* generateNeighbors(s: SearchState): Generator<SearchState> {
    const courtsSorted = [...s.courts].sort((a, b) => a.courtId - b.courtId);

    // (a) 異なるコートの出場者2人を交換
    for (let i = 0; i < courtsSorted.length; i++) {
      for (let j = i + 1; j < courtsSorted.length; j++) {
        for (let slotI = 0; slotI < 4; slotI++) {
          for (let slotJ = 0; slotJ < 4; slotJ++) {
            const next = cloneState(s);
            const courtI = next.courts.find(c => c.courtId === courtsSorted[i].courtId)!;
            const courtJ = next.courts.find(c => c.courtId === courtsSorted[j].courtId)!;
            const tmp = courtI.slots[slotI];
            courtI.slots[slotI] = courtJ.slots[slotJ];
            courtJ.slots[slotJ] = tmp;
            yield next;
          }
        }
      }
    }

    // (b) 出場者1人と控え1人を交換
    for (const court of courtsSorted) {
      for (let slot = 0; slot < 4; slot++) {
        for (const benchId of s.bench) {
          const next = cloneState(s);
          const nc = next.courts.find(c => c.courtId === court.courtId)!;
          const benchIndex = next.bench.indexOf(benchId);
          const outgoing = nc.slots[slot];
          nc.slots[slot] = benchId;
          next.bench[benchIndex] = outgoing;
          next.bench.sort();
          yield next;
        }
      }
    }

    // (c) 1つのコート内のチーム分けを変更（4人を2対2に分ける方法は3通り。
    // 現在の分け方以外の2通りを近傍として提示する）
    for (const court of courtsSorted) {
      const [s0, s1, s2, s3] = court.slots;
      const alternatives: CourtState['slots'][] = [
        [s0, s2, s1, s3],
        [s0, s3, s1, s2],
      ];
      for (const alt of alternatives) {
        const next = cloneState(s);
        const nc = next.courts.find(c => c.courtId === court.courtId)!;
        nc.slots = alt;
        yield next;
      }
    }
  }

  // 4. 局所探索（最急降下）。改善が無くなるか MAX_ITERATIONS 回で終了。
  let currentEval = evaluate(state);
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let bestNeighbor: SearchState | null = null;
    let bestNeighborEval: Evaluation | null = null;
    let bestNeighborKey = '';

    for (const neighbor of generateNeighbors(state)) {
      const ev = evaluate(neighbor);
      if (bestNeighborEval === null) {
        bestNeighbor = neighbor;
        bestNeighborEval = ev;
        bestNeighborKey = stateKey(neighbor);
        continue;
      }
      const cmp = compareEval(ev, bestNeighborEval);
      if (cmp < 0) {
        bestNeighbor = neighbor;
        bestNeighborEval = ev;
        bestNeighborKey = stateKey(neighbor);
      } else if (cmp === 0) {
        const key = stateKey(neighbor);
        if (key < bestNeighborKey) {
          bestNeighbor = neighbor;
          bestNeighborEval = ev;
          bestNeighborKey = key;
        }
      }
    }

    if (!bestNeighbor || !bestNeighborEval) break;
    if (compareEval(bestNeighborEval, currentEval) >= 0) break; // 改善なし

    state = bestNeighbor;
    currentEval = bestNeighborEval;
  }

  // 5. 結果を CourtAssignment[] へ変換（入力の courtIds 順）
  const byCourtId = new Map(state.courts.map(c => [c.courtId, c] as const));
  const result: CourtAssignment[] = [];
  for (const courtId of usedCourtIds) {
    const court = byCourtId.get(courtId);
    if (!court) continue;
    result.push({
      courtId,
      teamA: [court.slots[0], court.slots[1]],
      teamB: [court.slots[2], court.slots[3]],
    });
  }
  return result;
}
