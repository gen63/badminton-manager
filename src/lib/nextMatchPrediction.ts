/**
 * 次の試合に入るメンバーの予測
 *
 * 配置アルゴリズム (`assignCourts`) は与えられた状態に対して決定的なので、
 * 「次に配置が走るときの状態」を先読みして同じ関数を空打ちすれば、次の試合の
 * メンバーを事前に出せる。UI はこれを使って待機カードを強調し、対象メンバーに
 * 準備を促す。
 *
 * シナリオの作り方:
 *   - 空きコートがある場合: 次の配置は「自動配置」でその空きコートに走る。
 *     現在の待機者に対して `assignCourts` を 1 回打てば結果は確定する（1シナリオ）。
 *   - 全コートが埋まっている場合: 次の配置はどれかのコートが終わったときに走る
 *     （連続モードなら `computeFinishAndContinue` が、OFF なら手動の自動配置が、
 *     どちらも同じ `assignCourts` を呼ぶ）。どのコートが先に終わるかは分からない
 *     ので、**プレイ中の各コートが終わったケースを全部シミュレート**する。
 *
 * 各メンバーの「選ばれたシナリオの割合」＝出現率でランク付けし、100% を「ほぼ確定」、
 * `LIKELY_THRESHOLD` 以上を「候補」として見せる（それ未満は表示しない）。
 * 詳細: docs/plans/2026-08-13-next-match-prediction.md
 */

import type { Player } from '../types/player';
import type { Court } from '../types/court';
import type { Match } from '../types/match';
import type { Reservation } from '../types/reservation';
import { assignCourts } from './algorithm';
import { getPlayersPerCourt, hasUnresolvedOps } from './gameOperations';
import { withInProgressGames } from './effectiveGames';

/**
 * 「候補」として表示する最低出現率。
 *
 * 3コート稼働・待機10人だと全シナリオ共通（出現率 100%）で残るのは平均2人程度で、
 * 4人揃うのは 20% ほどしかない（`docs/plans/2026-08-13-next-match-prediction.md` の
 * 計測）。「確定4人」は原理的に出せないので、出現率でランク付けし、**半分以上の
 * シナリオで選ばれた人**を「比較的確率が高いメンバー」として見せる。
 *
 * ただし閾値だけだと 3 コート時に 2〜3 人しか出ないことがあるので、次の試合の
 * 定員（ダブルス 4 人 / シングルス 2 人）に届くまでは出現率の高い順に補充する。
 */
export const LIKELY_THRESHOLD = 0.5;

export interface NextMatchPrediction {
  /** 全シナリオで選出されたメンバー（出現率 100% = ほぼ確定） */
  certainIds: Set<string>;
  /** 出現率が LIKELY_THRESHOLD 以上 100% 未満のメンバー（候補） */
  likelyIds: Set<string>;
  /** メンバー ID → 出現率（0〜1）。閾値未満の人も含む全候補 */
  appearanceRate: Map<string, number>;
  /** 評価できたシナリオ数。0 なら予測不能（配置が成立しない） */
  scenarioCount: number;
  /** シナリオ別の内訳（どのコートが終わったら誰が入るか） */
  scenarios: NextMatchScenario[];
}

export interface NextMatchScenario {
  /** このシナリオで空く（= 配置対象の）コート */
  courtId: number;
  /** そのとき選出されるメンバー */
  playerIds: string[];
}

export interface NextMatchPredictionOptions {
  /** 練習開始日時（滞在時間優先モードの起点算出に必須） */
  practiceStartTime?: number;
  useStayDurationPriority: boolean;
  gameMode: 'singles' | 'doubles';
  lateBalanceMode?: boolean;
  genderBalanceMode?: boolean;
  reservationBlockThreshold?: number;
}

const EMPTY_PREDICTION: NextMatchPrediction = {
  certainIds: new Set(),
  likelyIds: new Set(),
  appearanceRate: new Map(),
  scenarioCount: 0,
  scenarios: [],
};

/** コートに乗っているメンバー ID の集合 */
function playersOnCourts(courts: Court[]): Set<string> {
  return new Set(
    courts.flatMap(c => [...c.teamA, ...c.teamB]).filter(id => id && id.trim()),
  );
}

/**
 * 1 シナリオ分の `assignCourts` 空打ち。配置に使う引数は MainPage の
 * `handleAutoAssign` / `computeFinishAndContinue` と同じ組み合わせに揃える
 * （ここがズレると予測と実配置が食い違う）。
 * 配置できなければ null。
 */
function runScenario(
  players: Player[],
  courts: Court[],
  matchHistory: Match[],
  reservations: Reservation[],
  targetCourtIds: number[],
  options: NextMatchPredictionOptions,
): string[] | null {
  const inCourts = playersOnCourts(courts);
  // 公平性判定の母集団には「配置済み（=コート上にいる）メンバー」を +1 して混ぜる。
  // 詳細: docs/plans/2026-08-13-in-progress-games-in-fairness.md
  const effectivePlayers = withInProgressGames(players, courts);
  const waitingPlayers = effectivePlayers.filter(p => !p.isResting && !inCourts.has(p.id));
  const activePlayers = effectivePlayers.filter(p => !p.isResting);
  const restingPlayers = effectivePlayers.filter(p => p.isResting && !inCourts.has(p.id));

  try {
    const assignments = assignCourts(waitingPlayers, targetCourtIds.length, matchHistory, {
      totalCourtCount: courts.length,
      targetCourtIds,
      practiceStartTime: options.practiceStartTime,
      allPlayers: activePlayers,
      useStayDurationPriority: options.useStayDurationPriority,
      reservations,
      gameMode: options.gameMode,
      lateBalanceMode: options.lateBalanceMode,
      genderBalanceMode: options.genderBalanceMode,
      reservationBlockThreshold: options.reservationBlockThreshold,
      restingPlayers,
    });
    if (assignments.length === 0) return null;
    return assignments
      .flatMap(a => [...a.teamA, ...a.teamB])
      .filter(id => id && id.trim());
  } catch {
    // 人数不足など。そのシナリオは予測不能として捨てる
    return null;
  }
}

/**
 * 指定コートの試合が今終わった状態を作る。
 * `computeFinishAndContinue` の「1. 試合記録」「2. プレイヤー統計 + 試合後の休憩判定」
 * 「3. コートをクリア」と同じ更新を、書き込み無しで再現する。
 */
function simulateFinish(
  players: Player[],
  courts: Court[],
  matchHistory: Match[],
  reservations: Reservation[],
  court: Court,
  now: number,
): {
  players: Player[];
  courts: Court[];
  matchHistory: Match[];
  reservations: Reservation[];
} {
  const participantIds = [...court.teamA, ...court.teamB].filter(id => id);
  const participantSet = new Set(participantIds);

  const reservationsAfter = reservations.map(r =>
    r.status === 'pending' &&
    r.playerIds.length > 0 &&
    r.playerIds.every(id => participantSet.has(id))
      ? { ...r, status: 'fulfilled' as const, fulfilledAt: now }
      : r,
  );
  const pendingReservedIds = new Set(
    reservationsAfter.filter(r => r.status === 'pending').flatMap(r => r.playerIds),
  );
  const restReturnIds = new Set(court.restingPlayerIds ?? []);

  const playersAfter = players.map(p => {
    if (!participantSet.has(p.id)) return p;
    const forceRestAgain = p.forcedRestAt !== undefined && hasUnresolvedOps(p);
    return {
      ...p,
      gamesPlayed: p.gamesPlayed + 1,
      lastPlayedAt: now,
      isResting: forceRestAgain || restReturnIds.has(p.id) || pendingReservedIds.has(p.id),
    };
  });

  const courtsAfter = courts.map(c =>
    c.id === court.id
      ? { ...c, teamA: ['', ''] as [string, string], teamB: ['', ''] as [string, string], isPlaying: false }
      : c,
  );

  // ペア・対戦相手の重複ペナルティに効かせるため、終わった試合も履歴に積む
  const finishedMatch: Match = {
    id: `prediction-${court.id}-${now}`,
    courtId: court.id,
    teamA: court.teamA,
    teamB: court.teamB,
    scoreA: 0,
    scoreB: 0,
    startedAt: court.startedAt > 0 ? court.startedAt : now,
    finishedAt: now,
  };

  return {
    players: playersAfter,
    courts: courtsAfter,
    matchHistory: [...matchHistory, finishedMatch],
    reservations: reservationsAfter,
  };
}

/**
 * 次の試合に入るメンバーを予測する。
 *
 * 予測であって確約ではない（休憩の切り替え・メンバー追加・タップ交換で変わる）。
 * UI 側で「予測」と明示すること。
 */
export function predictNextMatchPlayers(
  players: Player[],
  courts: Court[],
  matchHistory: Match[],
  reservations: Reservation[],
  options: NextMatchPredictionOptions,
): NextMatchPrediction {
  if (courts.length === 0) return EMPTY_PREDICTION;

  const emptyCourtIds = courts
    .filter(c => !c.teamA[0] || c.teamA[0] === '')
    .map(c => c.id);

  const scenarios: NextMatchScenario[] = [];

  if (emptyCourtIds.length > 0) {
    // 空きコートがある = 次の配置対象は確定している
    const ids = runScenario(players, courts, matchHistory, reservations, emptyCourtIds, options);
    if (ids) scenarios.push({ courtId: emptyCourtIds[0], playerIds: ids });
  } else {
    const now = Date.now();
    // 準備中（配置済みで未開始）のコートは終わらないので、プレイ中のみ対象
    const playingCourts = courts.filter(c => c.isPlaying && c.teamA[0] && c.teamA[0] !== '');
    for (const court of playingCourts) {
      const after = simulateFinish(players, courts, matchHistory, reservations, court, now);
      const ids = runScenario(
        after.players, after.courts, after.matchHistory, after.reservations, [court.id], options,
      );
      if (ids) scenarios.push({ courtId: court.id, playerIds: ids });
    }
  }

  if (scenarios.length === 0) return EMPTY_PREDICTION;

  const appearances = new Map<string, number>();
  for (const scenario of scenarios) {
    for (const id of new Set(scenario.playerIds)) {
      appearances.set(id, (appearances.get(id) ?? 0) + 1);
    }
  }

  const certainIds = new Set<string>();
  const appearanceRate = new Map<string, number>();
  for (const [id, count] of appearances) {
    const rate = count / scenarios.length;
    appearanceRate.set(id, rate);
    if (rate === 1) certainIds.add(id);
  }

  // 出現率の高い順に候補を積む。閾値以上は全部入れ、閾値未満でも次の試合の定員に
  // 届くまでは補充する（同率の人は打ち切らずまとめて入れる）。
  const capacity = getPlayersPerCourt(options.gameMode);
  const likelyIds = new Set<string>();
  let lastIncludedRate = Number.POSITIVE_INFINITY;
  const ranked = [...appearanceRate.entries()]
    .filter(([, rate]) => rate < 1)
    .sort((a, b) => b[1] - a[1]);
  for (const [id, rate] of ranked) {
    const needsMore = certainIds.size + likelyIds.size < capacity;
    if (rate >= LIKELY_THRESHOLD || needsMore || rate === lastIncludedRate) {
      likelyIds.add(id);
      lastIncludedRate = rate;
    } else {
      break;
    }
  }

  return {
    certainIds,
    likelyIds,
    appearanceRate,
    scenarioCount: scenarios.length,
    scenarios,
  };
}
