/**
 * ゲーム操作の純粋関数
 *
 * Transaction内でリモート状態に対して適用するため、
 * ストアに依存しない純粋関数として実装。
 */

import type { Player } from '../types/player';
import type { Court } from '../types/court';
import type { Match } from '../types/match';
import type { Reservation } from '../types/reservation';
import { assignCourts } from './algorithm';

export interface GameState {
  players: Player[];
  courts: Court[];
  matchHistory: Match[];
  reservations: Reservation[];
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
  }
): FinishGameResult {
  const court = state.courts.find(c => c.id === courtId);
  if (!court || !court.isPlaying) {
    return { newState: state, continuousNextApplied: false };
  }

  const now = Date.now();
  const playersPerCourt = options.gameMode === 'singles' ? 2 : 4;

  // 1. 試合記録を作成
  const match: Match = {
    id: crypto.randomUUID(),
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

  // 3. restingPlayerIds の復元
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
      ? {
          ...c,
          teamA: ['', ''] as [string, string],
          teamB: ['', ''] as [string, string],
          scoreA: 0,
          scoreB: 0,
          isPlaying: false,
          startedAt: 0,
          finishedAt: 0,
          restingPlayerIds: [],
        }
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

    // ブロックチェック（prioritizeDiversity ON時）
    if (options.prioritizeDiversity) {
      const occupied = updatedCourts.filter(c => c.isPlaying || (c.teamA[0] && c.teamA[0] !== ''));
      const active = updatedPlayers.filter(p => !p.isResting);
      const actualWaiting = active.length - occupied.length * playersPerCourt;
      const threshold = options.gameMode === 'singles' ? 3 : 7;
      if (occupied.length > 0 && actualWaiting < threshold) {
        continuousError = 'diversity_block';
      }
    }

    if (!continuousError) {
      const minWaiting = options.gameMode === 'singles' ? 3 : 7;
      if (waitingPlayers.length < minWaiting) {
        continuousError = 'not_enough_players';
      }
    }

    if (!continuousError) {
      const assignments = assignCourts(waitingPlayers, 1, updatedMatchHistory, {
        targetCourtIds: [courtId],
        totalCourtCount: updatedCourts.length,
        useStayDurationPriority: options.useStayDurationPriority,
        reservations: state.reservations,
        gameMode: options.gameMode,
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

  return {
    newState: {
      players: updatedPlayers,
      courts: updatedCourts,
      matchHistory: updatedMatchHistory,
      reservations: state.reservations,
    },
    continuousNextApplied,
    continuousError,
  };
}
