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
  type AffinityPair,
} from './objective';

/** 強度「必ず」の希望ペア1組ぶんの入力。`docs/plans/2026-08-31-pair-preference.md` 3d 参照 */
export interface StrongPair {
  a: string;
  b: string;
}

export interface AssignRoundParams {
  /** このラウンドの配置対象（待機者） */
  candidates: Player[];
  /** 埋めるコート */
  courtIds: number[];
  /**
   * 登録レートそのままの順位（ハシゴ式適用**前**、0始まり）。
   *
   * 用途は**順位差のハード制約のみ**。「初期レートの高い人と下位層を混ぜない」
   * ための判定に使う（`formRankById` と両方で判定し、どちらかを破れば違反）。
   * 帯の形成（`skillGap`）とチームの釣り合い（`competitive` / `normalizeSplit`）
   * には使わない — そちらは `formRankById`。
   *
   * 2026-08-18 に一度この用途からも外して `formRankById` だけで判定していたが、
   * 登録レート的な最上位層と最下位層の同居が実データで 56.2% まで起きたため
   * 2026-08-25 に復活させた。
   */
  rankById: Map<string, number>;
  /**
   * ハシゴ式（`applyStreakSwaps`）適用**後**の順位。省略時は `rankById` と同じ。
   *
   * **これが実働の序列**。登録レートはこの序列の初期値でしかなく、以後は当日の
   * 勝敗で上下する。帯の形成（`skillGap`）とチームの釣り合い（`competitive` /
   * `normalizeSplit`）はこちらを使う。
   *
   * `reachableCountById` はこの序列だけで数える。順位差のハード制約と初期解の
   * 実現可能性判定は **この序列と `rankById` の両方**で判定する（どちらかを
   * 破れば違反）。
   *
   * 旧エンジンは安全網（`hasWideRankSpan`）を登録序列だけで張っていたが、それだと
   * 登録レートが実力とズレている人が実力相応の帯まで降りられない（登録4位の人は
   * ハシゴ式で13位まで沈んでも 16位以降と同居できず、勝率が23%で頭打ちになった）。
   * 逆にこの序列だけにすると、登録レート的な最上位層と最下位層の同居が実データで
   * 56.2% まで起きた。**両方を課すのが折衷案**で、ハシゴ式の振れ幅は
   * `maxDrift`（±1グループ）が抑える。
   */
  formRankById?: Map<string, number>;
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
  /** 後半均等化モード。公平性の窓を狭めて優先度順に近づける */
  lateBalanceMode?: boolean;
  weights?: Partial<ObjectiveWeights>;
  /**
   * 希望ペアの一覧。省略時は空配列（＝ペア希望なし）。
   * `docs/plans/2026-08-31-pair-preference.md` 参照。
   *
   * **`Map<pairKey, deficit>` ではなく配列。** pairKey は `[a, b].sort().join(',')`
   * のような不可逆な文字列なので、Map 形式だと「候補プールの全ペアを毎回
   * 列挙してキーを引く」しかできない。希望ペアは実運用で1〜3組しかないため、
   * 配列にして「希望ペアだけを回して2人の所在を調べる」向きにすることで、
   * 候補人数に依存しない O(希望組数) にしている（詳細は `objective.ts` の
   * `AffinityPair` のコメント）。
   */
  affinityPairs?: AffinityPair[];
  /**
   * 強度「必ず」の希望ペアの一覧。両方が同じラウンドで出場するなら
   * 必ず味方にする（ハード制約）。片方だけの出場は違反にしない。
   * `docs/plans/2026-08-31-pair-preference.md` の 3d 参照。省略時は空配列。
   *
   * `affinityPairs` と同じ理由で pairKey の Set ではなく配列にしている。
   */
  strongPairs?: StrongPair[];
}

/** 局所探索の反復上限 */
const MAX_ITERATIONS = 200;

/**
 * 公平性の窓の緩み。余剰人数（候補数 − 必要人数）のうち何割まで
 * 「優先度順を飛ばしてよいか」を決める。0 なら完全に優先度順（質の最適化の
 * 自由度ゼロ）、1 なら窓なし（従来）。
 *
 * 固定値にすると候補プールがコート数に対して十分大きい条件でしか発動せず、
 * 遅参加の過剰が最も酷い 14人2コート / 18人3コートで効かなかった。
 */
const FAIRNESS_WINDOW_RATIO = 0.7;

/**
 * 後半均等化モードのときの窓の緩み。通常より狭くして優先度順に近づける。
 *
 * 「試合数のバラつきをゼロにする」のではなく「減らす」オプションなので 0 にはしない。
 * bench（SEEDS=60 NOISE=0）で 0.7 → 0.3 にすると試合数幅が 21人3C で 1.33 → 1.05、
 * 16人2C で 2.00 → 1.25 に縮み、代償は 3-1 が +1.7〜2.0pt 程度。0.2 以下は幅が
 * ほとんど縮まらないのに 3-1 だけ悪化し、0 では 3-1 が 8% まで崩れる。
 */
const LATE_BALANCE_WINDOW_RATIO = 0.3;

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
    lateBalanceMode = false,
  } = params;

  const formRankById = params.formRankById ?? rankById;
  const affinityPairs = params.affinityPairs ?? [];
  const strongPairs = params.strongPairs ?? [];

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
    const rankDiff = (formRankById.get(a.id) ?? 0) - (formRankById.get(b.id) ?? 0);
    if (rankDiff !== 0) return rankDiff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const candidateCount = sortedCandidates.length;

  // 各候補が「同じコートに入れる相手」の人数。variety の閾値スケールに使う。
  const reachableCountById = new Map<string, number>(
    candidates.map(p => {
      if (wideSpanThreshold === null) return [p.id, candidates.length - 1] as const;
      const rank = formRankById.get(p.id) ?? 0;
      const count = candidates.filter(
        q => q.id !== p.id && Math.abs((formRankById.get(q.id) ?? 0) - rank) < wideSpanThreshold
      ).length;
      return [p.id, count] as const;
    })
  );
  const priorityRankById = new Map<string, number>(
    sortedCandidates.map((p, index) => [p.id, index] as const)
  );

  // affinity（ペア希望）の評価対象ペア数。`computeAffinity` と同じ「courts ∪ bench」
  // = このラウンドの候補プール全体（= sortedCandidates 全員）で数える。courts と
  // bench の中身は探索中に変わるが、その和集合（母集団）は不変なので、
  // 探索前に一度だけ数えれば足りる（`splitCost` は毎回この値で割る）。
  //
  // **候補プールの全ペアではなく `affinityPairs`（実運用1〜3組）だけを回す。**
  // 候補人数の2乗で回す実装は、局所探索が `evaluate()`/`splitCost` を数万回
  // 呼ぶ構造と組み合わさって実測 4〜8倍の性能回帰になったため、希望ペア側から
  // 走査する向きに変えている（`AffinityPair` のコメント参照）。
  const candidateIdSet = new Set(sortedCandidates.map(p => p.id));
  const affinityTargetCount = (() => {
    let count = 0;
    for (const { a, b, deficit } of affinityPairs) {
      if (!deficit) continue;
      if (candidateIdSet.has(a) && candidateIdSet.has(b)) count++;
    }
    return count;
  })();

  const neededCount = Math.min(4 * courtIds.length, candidateCount - (candidateCount % 4));
  const usableCourtCount = Math.min(courtIds.length, Math.floor(candidateCount / 4));
  const usedCourtIds = courtIds.slice(0, usableCourtCount);

  const selected = sortedCandidates.slice(0, neededCount);

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
      const rankA = formRankById.get(a.id) ?? 0;
      const rankB = formRankById.get(b.id) ?? 0;
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
      const courtRanks: number[] = [formRankById.get(pool[0].id) ?? 0];
      // 登録序列側の幅も同時に見る。局所探索の近傍は「出場者⇔控えの1人スワップ」
      // しか無いため、4人中2人を同時に入れ替えないと解消しない違反は初期解から
      // 抜け出せない（例: ハシゴ式序列では隣同士だが登録序列では両端、という4人。
      // 1人ずつ入れ替えても幅が閾値未満にならず、最急降下がその場に留まる）。
      const courtBaseRanks: number[] = [rankById.get(pool[0].id) ?? 0];

      // 制約を満たす範囲で優先度順に3人追加。
      //
      // 4人目は直近試合の重複（`isRecentDuplicate`）も避ける。局所探索の近傍は
      // 「出場者⇔控えの1人スワップ」しか無いため、4人中2人を同時に入れ替えないと
      // 直らない重複は初期解から抜け出せない。順位差と同じく初期解の段階で避ける。
      for (let i = 1; i < pool.length && chosenIndices.length < 4; i++) {
        const rank = formRankById.get(pool[i].id) ?? 0;
        const gap = Math.max(...courtRanks, rank) - Math.min(...courtRanks, rank);
        if (gap >= threshold) continue;
        const baseRank = rankById.get(pool[i].id) ?? 0;
        const baseGap =
          Math.max(...courtBaseRanks, baseRank) - Math.min(...courtBaseRanks, baseRank);
        if (baseGap >= threshold) continue;
        if (chosenIndices.length === 3) {
          const members = [...chosenIndices.map(k => pool[k].id), pool[i].id];
          if (isRecentDuplicate(members)) continue;
        }
        chosenIndices.push(i);
        courtRanks.push(rank);
        courtBaseRanks.push(baseRank);
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

  // 初期解の直近試合重複を、未配置の候補との1人入れ替えで解消する。
  //
  // 局所探索の近傍は「出場者⇔控えの1人スワップ」だけなので、4人中2人を同時に
  // 入れ替えないと直らない重複は初期解から抜け出せない（辞書式評価は違反を
  // 増やさないが、減らせない手しか無ければその場に留まる）。順位差の制約と同じく
  // 初期解の段階で潰しておく。順位差の制約を新たに破る入れ替えは採らない。
  {
    const placed = new Set<string>();
    for (const court of initialCourts) for (const id of court.slots) placed.add(id);
    const spare = sortedCandidates.filter(p => !placed.has(p.id));

    for (const court of initialCourts) {
      if (!isRecentDuplicate(courtMembers(court))) continue;
      const acceptable = (trial: CourtState['slots']): boolean => {
        if (isRecentDuplicate([...trial])) return false;
        if (wideSpanThreshold === null) return true;
        for (const rankMap of [formRankById, rankById]) {
          const ranks = trial.map(id => rankMap.get(id) ?? 0);
          if (Math.max(...ranks) - Math.min(...ranks) >= wideSpanThreshold) return false;
        }
        return true;
      };
      const apply = (trial: CourtState['slots'], slots: number[], picks: number[]): void => {
        const removed = slots.map(slot => sortedCandidates.find(p => p.id === court.slots[slot])!);
        court.slots = trial;
        // 外した人は次のコートの入れ替え候補として控えに戻す
        picks.forEach((s, k) => { spare[s] = removed[k]; });
      };

      let fixed = false;
      // まず1人入れ替え。優先度の低い出場者から試す（公平性への影響を小さくするため）
      for (let slot = 3; slot >= 0 && !fixed; slot--) {
        for (let s = 0; s < spare.length && !fixed; s++) {
          const trial = [...court.slots] as CourtState['slots'];
          trial[slot] = spare[s].id;
          if (!acceptable(trial)) continue;
          apply(trial, [slot], [s]);
          fixed = true;
        }
      }
      // 1人では直らない場合に2人同時。直近試合と完全に一致する4人は、1人だけ
      // 外しても残り3人が一致して overlap>=3 のままなので、2人同時でしか解けない。
      for (let a = 0; a < 4 && !fixed; a++) {
        for (let b = a + 1; b < 4 && !fixed; b++) {
          for (let s = 0; s < spare.length && !fixed; s++) {
            for (let t = s + 1; t < spare.length && !fixed; t++) {
              const trial = [...court.slots] as CourtState['slots'];
              trial[a] = spare[s].id;
              trial[b] = spare[t].id;
              if (!acceptable(trial)) continue;
              apply(trial, [a, b], [s, t]);
              fixed = true;
            }
          }
        }
      }
    }
  }

  // 控えは「実際にコートへ配置されなかった人」から求める。
  //
  // `sortedCandidates.slice(neededCount)` のように静的に決めてはいけない。
  // 順位差の制約がある分岐では優先度順の先頭 neededCount 人がそのまま出場するとは
  // 限らず（制約を満たす人を後ろから拾う）、コートに出た人が控えにも残ってしまう。
  // その状態で「出場者⇔控え」のスワップが走ると**同一人物が1試合に重複し、
  // 別の1人が消える**（実測で全試合の10.5%が破損した）。
  const placedIds = new Set<string>();
  for (const court of initialCourts) {
    for (const id of court.slots) placedIds.add(id);
  }
  const bench = sortedCandidates
    .filter(p => !placedIds.has(p.id))
    .map(p => p.id)
    .sort();

  // 2b. チーム分けの正規化。
  //
  // 目的関数のうちチーム分け（4人をどう2対2に割るか）に依存するのは
  // `competitive` と `mixSplit` の2つだけで、どちらもコートごとの寄与の平均。
  // つまり**各コートを独立に最適化すれば全体最適**になるので、探索状態には
  // 「誰がどのコートか」だけを持たせ、分け方は毎回ここで導出する。
  //
  // これを局所探索に任せると、最急降下では「入れ替え → 分け直し」の2手を
  // またげず、途中の悪い分け方に阻まれて入れ替え自体が却下される
  // （実測: 少数派2人を同じコートに集める修復が 3-1×2 のまま止まった）。
  const splitCost = (slots: CourtState['slots']): number => {
    const rankOf = (id: string): number => formRankById.get(id) ?? 0;
    const diff = Math.abs(
      rankOf(slots[0]) + rankOf(slots[1]) - rankOf(slots[2]) - rankOf(slots[3])
    );
    const competitive = (diff / Math.max(1, rosterSize - 1)) * weights.competitive;

    const genders = slots.map(id => genderById.get(id));
    const allGendered = genders.every(g => g === 'M' || g === 'F');
    const isTwoTwo = allGendered && genders.filter(g => g === 'M').length === 2;
    const maleInA = (genders[0] === 'M' ? 1 : 0) + (genders[1] === 'M' ? 1 : 0);
    const mixSplit = isTwoTwo && maleInA !== 1 ? weights.mixSplit : 0;

    // affinity（ペア希望）。`computeAffinity`（objective.ts）は「誰がどのコートか」
    // だけを見て味方/敵を判定するが、チーム分け（teamA/teamB）自体は
    // `normalizeSplit` がこの `splitCost` だけで決めており、探索状態には
    // 含まれない（2b のコメント参照）。ここに足さないと「2人を同じコートに
    // 集めるところまでは効くが、味方にならず敵同士になる」という中途半端な
    // 結果になる（`docs/plans/2026-08-31-pair-preference.md` 4. 実装上の落とし穴）。
    // 味方（同チーム）は寄与0なので、チームを跨ぐ組み合わせだけを見ればよい。
    //
    // `affinityPairs`（実運用1〜3組）だけを回す。`normalizeSplit` は1コートにつき
    // 3通りの分け方を試すたびにこれを呼ぶため、`pairKeyOf`（sort+join の文字列
    // 生成）を避けて ID の直接比較にしている。
    let affinity = 0;
    if (affinityTargetCount > 0) {
      for (const { a, b, deficit } of affinityPairs) {
        if (!deficit) continue;
        const aInTeamA = slots[0] === a || slots[1] === a;
        const aInTeamB = slots[2] === a || slots[3] === a;
        const bInTeamA = slots[0] === b || slots[1] === b;
        const bInTeamB = slots[2] === b || slots[3] === b;
        const crossTeam = (aInTeamA && bInTeamB) || (aInTeamB && bInTeamA);
        if (!crossTeam) continue;
        affinity += (deficit * 0.5) / affinityTargetCount;
      }
    }

    return competitive + mixSplit + affinity * weights.affinity;
  };

  /** コート4人を、コスト最小の分け方に並べ替える（同点は実力順で決定的に選ぶ） */
  const normalizeSplit = (slots: CourtState['slots']): CourtState['slots'] => {
    const [a, b, c, d] = [...slots].sort((x, y) => {
      const rankDiff = (formRankById.get(x) ?? 0) - (formRankById.get(y) ?? 0);
      if (rankDiff !== 0) return rankDiff;
      return x < y ? -1 : x > y ? 1 : 0;
    });
    const options: CourtState['slots'][] = [
      [a, d, b, c],
      [a, c, b, d],
      [a, b, c, d],
    ];
    let best = options[0];
    let bestCost = splitCost(best);
    for (const option of options.slice(1)) {
      const cost = splitCost(option);
      if (cost < bestCost) {
        best = option;
        bestCost = cost;
      }
    }
    return best;
  };

  const normalizeState = (s: SearchState): SearchState => {
    for (const court of s.courts) court.slots = normalizeSplit(court.slots);
    return s;
  };

  let state: SearchState = normalizeState({ courts: initialCourts, bench });

  const evaluate = (s: SearchState): Evaluation => {
    let violations = 0;
    const placements: CourtPlacement[] = s.courts.map(toPlacement);
    for (const court of s.courts) {
      const members = courtMembers(court);
      if (wideSpanThreshold !== null) {
        // 順位差のハード制約は **2つの序列の両方** で判定する。
        //
        //   formRank（ハシゴ式後） … 当日の調子を含めた実働の帯を守る
        //   rankById（登録レート）  … 登録レート的な最上位層と最下位層を混ぜない
        //
        // formRank だけで判定していた時期は、ハシゴ式で序列が入れ替わるぶん
        // 「登録レートの上位1/3 × 下位1/3」の同居が実データで 56.2% まで起きていた
        // （2026-08-22 / 20人48試合）。運用上「初期レートの高い人が下位と混ざる
        // 試合は避けたい」という要求があり、登録序列側の判定を足した。
        // 計測: docs/plans/2026-08-05-pairing-goals-and-rewrite.md
        // formRankById 省略時は rankById と同一なので二重に数えない
        const rankMaps =
          formRankById === rankById ? [formRankById] : [formRankById, rankById];
        for (const rankMap of rankMaps) {
          const ranks = members
            .map(id => rankMap.get(id))
            .filter((r): r is number => r !== undefined);
          if (ranks.length === members.length) {
            const gap = Math.max(...ranks) - Math.min(...ranks);
            if (gap >= wideSpanThreshold) violations++;
          }
        }
      }
      if (isRecentDuplicate(members)) violations++;
    }
    // 強度「必ず」の希望ペア: 両方が同じラウンドで出場するなら必ず味方にする
    // （ハード制約）。片方だけの出場は違反にしない（(a) の意味論のみ採用。
    // `docs/plans/2026-08-31-pair-preference.md` 3d 参照）。
    //
    // ベンチにいる人は対象外なので、courts に現れる人だけを母集団に判定すれば
    // 足りる（bench まで含める affinity の分母とは違い、こちらは courts のみ）。
    // コート所属・パートナーの Map（O(出場者数)）は今までどおり1回だけ構築するが、
    // それを使って「コート上の全ペア」を回すのではなく **`strongPairs`（実運用
    // 1〜2組）だけ**を回す。前者は evaluate() を数万回呼ぶ局所探索と組み合わさって
    // 実測 4〜8倍の性能回帰になったため、希望ペア側から走査する向きに変えている。
    if (strongPairs.length > 0) {
      const courtIdOfMember = new Map<string, number>();
      const partnerOfMember = new Map<string, string>();
      for (const court of s.courts) {
        const members = courtMembers(court);
        for (const id of members) courtIdOfMember.set(id, court.courtId);
        partnerOfMember.set(court.slots[0], court.slots[1]);
        partnerOfMember.set(court.slots[1], court.slots[0]);
        partnerOfMember.set(court.slots[2], court.slots[3]);
        partnerOfMember.set(court.slots[3], court.slots[2]);
      }
      for (const { a, b } of strongPairs) {
        const courtA = courtIdOfMember.get(a);
        const courtB = courtIdOfMember.get(b);
        if (courtA === undefined || courtB === undefined) continue; // 片方でもベンチなら制約なし
        if (courtA !== courtB) {
          violations++; // 同じラウンドで出場しているのに別コート
        } else if (partnerOfMember.get(a) !== b) {
          violations++; // 同じコートだが敵同士
        }
      }
    }
    // 公平性の窓: 優先度順で「必要人数 + slack」番目より後ろの人を出場させない。
    // 旧エンジンは優先度順に上から取る構造だったので公平性が強く守られていた。
    // 新エンジンは fairness を重み付きの一項目にしたため、質の項に押し負けて
    // 出遅れている人を飛ばしてしまう。質の最適化は窓の中だけで行わせる。
    const surplus = candidateCount - neededCount;
    const ratio = lateBalanceMode ? LATE_BALANCE_WINDOW_RATIO : FAIRNESS_WINDOW_RATIO;
    const windowLimit = neededCount + Math.ceil(surplus * ratio);
    if (windowLimit < candidateCount) {
      for (const court of s.courts) {
        for (const id of courtMembers(court)) {
          if ((priorityRankById.get(id) ?? 0) >= windowLimit) violations++;
        }
      }
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
      reachableCountById,
      formRankById,
      affinityPairs,
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
            yield normalizeState(next);
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
          yield normalizeState(next);
        }
      }
    }

    // チーム分けを変更するだけの近傍は不要。`normalizeState` が全ての近傍で
    // 各コートを最適な分け方に揃えるため、探索の途中でも分け方は常に最適。
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
