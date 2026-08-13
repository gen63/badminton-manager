/**
 * ゲーム操作の純粋関数
 *
 * Transaction内でリモート状態に対して適用するため、
 * ストアに依存しない純粋関数として実装。
 */

import type { Player } from '../types/player';
import { EMPTY_COURT_STATE, type Court } from '../types/court';
import type { Match } from '../types/match';
import type { Reservation } from '../types/reservation';
import type { SyncSettings } from '../services/sessionService';
import { assignCourts, getCallableReservationRestingIds } from './algorithm';
import { withInProgressGames } from './effectiveGames';

/** 試合の自動終了までの経過時間（ms）。これを超えた試合は自動で終了する。 */
export const MATCH_AUTO_END_MS = 15 * 60 * 1000;

/**
 * 配置から試合の自動開始までの経過時間（ms）。
 * 「開始」が押されないままこれを超えたコートは、**配置時刻を開始時刻として**
 * 自動的に試合開始扱いにする。
 * 詳細: docs/plans/2026-08-13-auto-start-after-assign.md
 */
export const MATCH_AUTO_START_MS = 3 * 60 * 1000;

/**
 * 「次の試合に入りそう」呼び出し通知を出す試合経過時間の閾値（4分30秒）。
 * 実測（2026-08-11、有効 n=62、外れ値1件除外）: 5分17.5% / 6分31.7% / 7分30.2% /
 * 8分15.9% / 9分3.2%、平均6.55分・中央値6.5分・p10 5.0分・p90 8.0分。
 * 閾値5分だと発火率82%・リードタイム中央2分。ただし記録が分単位（丸め）のため
 * 「5分」の実体は4:30〜5:30。取りこぼしを避けて4:30に倒している。
 */
export const MATCH_CALL_THRESHOLD_MS = 4.5 * 60 * 1000;

/**
 * 自分がコートを降りてから「次の試合に入りそう」呼び出し通知を抑制する時間（90秒）。
 * 降りた直後はまだ物理的にコート脇に居るため呼ぶ必要が無く、鳴るとうるさいだけ。
 * 呼び損ねる実害がほぼ無い範囲として90秒とした。
 */
export const MATCH_CALL_COOLDOWN_MS = 90 * 1000;

/** ゲームモードに応じた1コートあたりの人数 */
export function getPlayersPerCourt(gameMode: 'singles' | 'doubles'): number {
  return gameMode === 'singles' ? 2 : 4;
}

/**
 * 会費・名簿が未対応か（sessionMutations.unresolvedOpsOf と同じ判定）。
 * gameOperations ⇄ sessionMutations の循環 import を避けるためここに小さく持つ。
 * 試合後の休憩判定を再現する nextMatchPrediction からも参照する。
 */
export function hasUnresolvedOps(p: Player): boolean {
  return !p.operationStatus?.payment || !p.operationStatus?.roster;
}

/** ゲームモードに応じた連続モード配置に必要な最小待機人数 */
export function getMinWaitingCount(gameMode: 'singles' | 'doubles'): number {
  return gameMode === 'singles' ? 3 : 7;
}

/** 練習種別（単/複/楽）をアルゴリズム用のゲームモードに変換 */
export function gameModeFromPracticeType(
  practiceType: '単' | '複' | '楽' | undefined,
): 'singles' | 'doubles' {
  return practiceType === '単' ? 'singles' : 'doubles';
}

/**
 * 連続モード配置のブロック判定（多様性優先モード用）
 * callableReservedCount: 予約成立で休憩から呼び出せるメンバー数
 * （待機扱いでカウントに加算する）
 */
function checkContinuousBlock(
  players: Player[],
  courts: Court[],
  forceBulkAssignment: boolean,
  gameMode: 'singles' | 'doubles',
  callableReservedCount: number = 0,
): { blocked: boolean; reason?: string } {
  if (!forceBulkAssignment) return { blocked: false };

  const ppc = getPlayersPerCourt(gameMode);
  const threshold = getMinWaitingCount(gameMode);
  const occupied = courts.filter(c => c.isPlaying || (c.teamA[0] && c.teamA[0] !== ''));
  const active = players.filter(p => !p.isResting);
  const actualWaiting = active.length + callableReservedCount - occupied.length * ppc;

  if (occupied.length > 0 && actualWaiting < threshold) {
    return { blocked: true, reason: 'diversity_block' };
  }
  return { blocked: false };
}

export interface GameState {
  players: Player[];
  courts: Court[];
  matchHistory: Match[];
  reservations: Reservation[];
  settings?: SyncSettings;
}

export interface FinishGameResult {
  newState: GameState;
  continuousNextApplied: boolean;
  continuousError?: string;
}

/**
 * 試合終了 + 連続モード配置を純粋関数として計算。
 * Transaction内でリモート状態に対して適用する。
 */
export function computeFinishAndContinue(
  state: GameState,
  courtId: number,
  options: {
    continuousMatchMode: boolean;
    useStayDurationPriority: boolean;
    forceBulkAssignment: boolean;
    gameMode: 'singles' | 'doubles';
    matchId?: string;
    lateBalanceMode?: boolean;
    reservationBlockThreshold?: number;
    /**
     * 練習開始日時（`sessions/{id}.config.practiceStartTime`）。
     *
     * **待機時間優先モードには必須**。未指定だと `assignCourts` が `Date.now()` に
     * フォールバックし、`resolveStayStart` の `max(practiceStartTime, ...)` が常に
     * now を返して全員の滞在時間が下限 5 分に潰れる。優先スコアが
     * `gamesPlayed / 5` になり、試合回数モードと順序が一致してしまう
     * （＝待機時間モードが no-op になる）。
     * 詳細: docs/plans/2026-08-11-stay-duration-mode-not-applied.md
     */
    practiceStartTime?: number;
    /**
     * true のとき、連続モードが ON でもこの 1 回の自動配置を抑止する
     * （15 分超過の自動終了用）。`continuousMatchMode` 設定自体は変えない。
     */
    skipContinuous?: boolean;
  }
): FinishGameResult {
  const court = state.courts.find(c => c.id === courtId);
  if (!court || !court.isPlaying) {
    return { newState: state, continuousNextApplied: false };
  }

  const now = Date.now();

  // 1. 試合記録を作成
  const match: Match = {
    id: options.matchId ?? crypto.randomUUID(),
    courtId,
    teamA: court.teamA,
    teamB: court.teamB,
    scoreA: 0,
    scoreB: 0,
    startedAt: court.startedAt > 0 ? court.startedAt : now,
    finishedAt: now,
  };

  // 2. プレイヤーの統計を更新 + 試合後の休憩判定
  // - 未成立予約のメンバー全員がこの試合に出場していた場合、タップ交換など
  //   手動配置で予約を消化したとみなして fulfilled にする（GAMEOPS1 と同じ
  //   「全員が同じコートに乗った」判定）。
  // - 休憩からタップ交換で出場したメンバー（court.restingPlayerIds）は休憩へ戻す。
  // - 消化後もまだ未成立の予約を持つ者は休憩に戻す（次の予約待ち）。
  // - それ以外は待機に戻る。予約で呼び出された休憩者は、他に予約が無ければ
  //   待機に復帰する。
  const activePlayerIds = [...court.teamA, ...court.teamB].filter(id => id);
  const participantSet = new Set(activePlayerIds);
  const reservationsAfterFinish = state.reservations.map(r =>
    r.status === 'pending' &&
    r.playerIds.length > 0 &&
    r.playerIds.every(id => participantSet.has(id))
      ? { ...r, status: 'fulfilled' as const, fulfilledAt: now }
      : r,
  );
  const pendingReservedIds = new Set(
    reservationsAfterFinish
      .filter(r => r.status === 'pending')
      .flatMap(r => r.playerIds)
  );
  const restReturnIds = new Set(court.restingPlayerIds ?? []);
  let updatedPlayers = state.players.map(p => {
    if (activePlayerIds.includes(p.id)) {
      // 会費・名簿が未対応のまま一度ボーダーを超えて強制休憩になった
      // （forcedRestAt セット済み）メンバーは、試合終了ごとに待機ではなく
      // 強制休憩へ戻す。待機に戻すと連続配置や手動再投入で 60 秒ポーリングの
      // 再休憩より先に再出場してしまうため、ここで確定させる（毎試合ごと）。
      // forcedRestAt を更新して全員通知（useFirebaseSync）を再発火させる。
      const forceRestAgain = p.forcedRestAt !== undefined && hasUnresolvedOps(p);
      return {
        ...p,
        gamesPlayed: p.gamesPlayed + 1,
        lastPlayedAt: now,
        isResting: forceRestAgain || restReturnIds.has(p.id) || pendingReservedIds.has(p.id),
        ...(forceRestAgain ? { forcedRestAt: now } : {}),
      };
    }
    return p;
  });

  // 3. コートをクリア
  let updatedCourts = state.courts.map(c =>
    c.id === courtId
      ? { ...c, ...EMPTY_COURT_STATE }
      : c
  );

  const updatedMatchHistory = [...state.matchHistory, match];

  // 5. 連続モード配置
  let continuousNextApplied = false;
  let continuousError: string | undefined;

  if (options.continuousMatchMode && !options.skipContinuous) {
    const playersInCourts = new Set(
      updatedCourts.flatMap(c => [...c.teamA, ...c.teamB]).filter(id => id?.trim())
    );
    // 公平性判定の母集団には「配置済み（=このコートで既に試合を始めている）
    // メンバー」を +1 して混ぜる。ここで渡す updatedCourts は対象コートを
    // 既にクリアした後なので、この試合終了処理で既に +1 された4人には
    // 二重に乗らない（他コートで進行中のメンバーだけに乗る）。
    // 詳細: docs/plans/2026-08-13-in-progress-games-in-fairness.md
    const effectivePlayers = withInProgressGames(updatedPlayers, updatedCourts);
    const waitingPlayers = effectivePlayers.filter(
      p => !p.isResting && !playersInCourts.has(p.id)
    );

    // 予約成立で休憩から呼び出せるメンバーは配置に使えるため、待機人数の
    // 判定に加算する（例: 2コート10人で4人予約中は待機が最大6人になり、
    // これを数えないと最小待機人数ゲートを永久に下回る）。
    const callableReservedIds = getCallableReservationRestingIds(
      effectivePlayers,
      reservationsAfterFinish,
      playersInCourts,
      {
        gameMode: options.gameMode,
        reservationBlockThreshold: options.reservationBlockThreshold,
      },
    );

    // ブロックチェック
    const block = checkContinuousBlock(
      updatedPlayers, updatedCourts, options.forceBulkAssignment, options.gameMode,
      callableReservedIds.size,
    );
    if (block.blocked) {
      continuousError = block.reason;
    }

    if (!continuousError) {
      if (waitingPlayers.length + callableReservedIds.size < getMinWaitingCount(options.gameMode)) {
        continuousError = 'not_enough_players';
      }
    }

    if (!continuousError) {
      // ゲートは近似カウント（callable 加算）なので、assignCourts が
      // insufficient-players を投げる可能性が残る。試合終了自体は成立させたいので
      // 例外は assignment_failed として握りつぶす。
      let assignments: ReturnType<typeof assignCourts> = [];
      try {
        assignments = assignCourts(waitingPlayers, 1, updatedMatchHistory, {
          targetCourtIds: [courtId],
          totalCourtCount: updatedCourts.length,
          // 待機時間優先モードの滞在時間算出に必須（省略すると now にフォールバック
          // して全員の滞在時間が下限 5 分に潰れ、モードが効かなくなる）
          practiceStartTime: options.practiceStartTime,
          // 全アクティブプレイヤー (他コートでプレイ中の高 gamesPlayed 含む) を渡す。
          // lateBalance の maxGamesPlayed 算出に必要。これが無いと待機者だけから
          // max を取ってしまい、後半均等化ペナルティが過小評価される。
          allPlayers: effectivePlayers.filter((p) => !p.isResting),
          useStayDurationPriority: options.useStayDurationPriority,
          reservations: reservationsAfterFinish,
          gameMode: options.gameMode,
          lateBalanceMode: options.lateBalanceMode,
          reservationBlockThreshold: options.reservationBlockThreshold,
          // 予約は休憩中メンバーも呼び出せる（プレイ中でない休憩者）
          restingPlayers: effectivePlayers.filter((p) => p.isResting && !playersInCourts.has(p.id)),
        });
      } catch {
        assignments = [];
      }

      if (assignments[0]) {
        const assignment = assignments[0];
        const nextStartedAt = Date.now();
        updatedCourts = updatedCourts.map(c =>
          c.id === courtId
            ? {
                ...c,
                teamA: assignment.teamA,
                teamB: assignment.teamB,
                scoreA: 0,
                scoreB: 0,
                isPlaying: true,
                startedAt: nextStartedAt,
                finishedAt: 0,
                // 配置と同時に開始するため、配置時刻＝開始時刻
                assignedAt: nextStartedAt,
              }
            : c
        );
        // 予約で休憩から呼び出したメンバーは出場のため isResting=false にする
        if (assignment.activatedFromRestIds && assignment.activatedFromRestIds.length > 0) {
          const activateSet = new Set(assignment.activatedFromRestIds);
          updatedPlayers = updatedPlayers.map(p =>
            activateSet.has(p.id) ? { ...p, isResting: false } : p
          );
        }
        continuousNextApplied = true;
      } else {
        continuousError = 'assignment_failed';
      }
    }
  }

  // GAMEOPS1: 連続配置で消化された予約を fulfilled マークする。
  // (handleAutoAssign と同じロジックを composite に組み込む)
  let updatedReservations = reservationsAfterFinish;
  if (continuousNextApplied) {
    const placedCourt = updatedCourts.find(c => c.id === courtId);
    if (placedCourt) {
      const placedIds = new Set(
        [...placedCourt.teamA, ...placedCourt.teamB].filter(id => id && id.trim()),
      );
      const fulfilledNow = now;
      updatedReservations = reservationsAfterFinish.map(r =>
        r.status === 'pending' && r.playerIds.every(id => placedIds.has(id))
          ? { ...r, status: 'fulfilled' as const, fulfilledAt: fulfilledNow }
          : r,
      );
    }
  }

  return {
    newState: {
      ...state,
      players: updatedPlayers,
      courts: updatedCourts,
      matchHistory: updatedMatchHistory,
      reservations: updatedReservations,
    },
    continuousNextApplied,
    continuousError,
  };
}
