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
import { assignCourts } from './algorithm';

/** 試合の自動終了までの経過時間（ms）。これを超えた試合は自動で終了する。 */
export const MATCH_AUTO_END_MS = 15 * 60 * 1000;

/** ゲームモードに応じた1コートあたりの人数 */
export function getPlayersPerCourt(gameMode: 'singles' | 'doubles'): number {
  return gameMode === 'singles' ? 2 : 4;
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

/** 連続モード配置のブロック判定（多様性優先モード用） */
export function checkContinuousBlock(
  players: Player[],
  courts: Court[],
  prioritizeDiversity: boolean,
  gameMode: 'singles' | 'doubles',
): { blocked: boolean; reason?: string } {
  if (!prioritizeDiversity) return { blocked: false };

  const ppc = getPlayersPerCourt(gameMode);
  const threshold = getMinWaitingCount(gameMode);
  const occupied = courts.filter(c => c.isPlaying || (c.teamA[0] && c.teamA[0] !== ''));
  const active = players.filter(p => !p.isResting);
  const actualWaiting = active.length - occupied.length * ppc;

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
    prioritizeDiversity: boolean;
    gameMode: 'singles' | 'doubles';
    matchId?: string;
    lateBalanceMode?: boolean;
    reservationBlockThreshold?: number;
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
  // 試合を終えたメンバーのうち、未成立の予約を持つ者は休憩に戻す（次の予約待ち）。
  // それ以外は待機に戻る。これにより予約で呼び出された休憩者は、他に予約が無ければ
  // 待機に復帰し、予約があれば休憩のまま次の予約を待つ。
  const activePlayerIds = [...court.teamA, ...court.teamB].filter(id => id);
  const pendingReservedIds = new Set(
    state.reservations
      .filter(r => r.status === 'pending')
      .flatMap(r => r.playerIds)
  );
  let updatedPlayers = state.players.map(p => {
    if (activePlayerIds.includes(p.id)) {
      return {
        ...p,
        gamesPlayed: p.gamesPlayed + 1,
        lastPlayedAt: now,
        isResting: pendingReservedIds.has(p.id),
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
    const waitingPlayers = updatedPlayers.filter(
      p => !p.isResting && !playersInCourts.has(p.id)
    );

    // ブロックチェック
    const block = checkContinuousBlock(updatedPlayers, updatedCourts, options.prioritizeDiversity, options.gameMode);
    if (block.blocked) {
      continuousError = block.reason;
    }

    if (!continuousError) {
      if (waitingPlayers.length < getMinWaitingCount(options.gameMode)) {
        continuousError = 'not_enough_players';
      }
    }

    if (!continuousError) {
      const assignments = assignCourts(waitingPlayers, 1, updatedMatchHistory, {
        targetCourtIds: [courtId],
        totalCourtCount: updatedCourts.length,
        // 全アクティブプレイヤー (他コートでプレイ中の高 gamesPlayed 含む) を渡す。
        // lateBalance の maxGamesPlayed 算出に必要。これが無いと待機者だけから
        // max を取ってしまい、後半均等化ペナルティが過小評価される。
        allPlayers: updatedPlayers.filter((p) => !p.isResting),
        useStayDurationPriority: options.useStayDurationPriority,
        reservations: state.reservations,
        gameMode: options.gameMode,
        lateBalanceMode: options.lateBalanceMode,
        reservationBlockThreshold: options.reservationBlockThreshold,
        // 予約は休憩中メンバーも呼び出せる（プレイ中でない休憩者）
        restingPlayers: updatedPlayers.filter((p) => p.isResting && !playersInCourts.has(p.id)),
      });

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
  let updatedReservations = state.reservations;
  if (continuousNextApplied) {
    const placedCourt = updatedCourts.find(c => c.id === courtId);
    if (placedCourt) {
      const placedIds = new Set(
        [...placedCourt.teamA, ...placedCourt.teamB].filter(id => id && id.trim()),
      );
      const fulfilledNow = now;
      updatedReservations = state.reservations.map(r =>
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
