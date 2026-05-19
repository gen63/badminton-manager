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

  // 2. プレイヤーの統計を更新
  const activePlayerIds = [...court.teamA, ...court.teamB].filter(id => id);
  let updatedPlayers = state.players.map(p => {
    if (activePlayerIds.includes(p.id)) {
      return { ...p, gamesPlayed: p.gamesPlayed + 1, lastPlayedAt: now };
    }
    return p;
  });

  // 3. 休憩中プレイヤーの復元（試合前に休憩していたプレイヤーを休憩状態に戻す）
  if (court.restingPlayerIds && court.restingPlayerIds.length > 0) {
    updatedPlayers = updatedPlayers.map(p => {
      if (court.restingPlayerIds!.includes(p.id)) {
        return { ...p, isResting: true };
      }
      return p;
    });
  }

  // 4. コートをクリア
  let updatedCourts = state.courts.map(c =>
    c.id === courtId
      ? { ...c, ...EMPTY_COURT_STATE, restingPlayerIds: [] }
      : c
  );

  const updatedMatchHistory = [...state.matchHistory, match];

  // 5. 連続モード配置
  let continuousNextApplied = false;
  let continuousError: string | undefined;

  if (options.continuousMatchMode) {
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

  // diversity ブロックで配置できなかった場合は連続モードを OFF にする。
  // 旧実装は MainPage の useEffect が予防的に disable していたが、
  // 試合中の待機人数（プレイ中分を引いた数）で判定していたため
  // 「終了後なら配置できる」状況でも誤って OFF にしていた。
  // 本来 OFF にすべきタイミング = 終了後の post-finish 状態でブロック確定時
  // のみとし、そのロジックを transaction 内に集約する。
  const newSettings =
    continuousError === 'diversity_block' && state.settings
      ? { ...state.settings, continuousMatchMode: false }
      : state.settings;

  return {
    newState: {
      ...state,
      players: updatedPlayers,
      courts: updatedCourts,
      matchHistory: updatedMatchHistory,
      reservations: updatedReservations,
      settings: newSettings,
    },
    continuousNextApplied,
    continuousError,
  };
}
