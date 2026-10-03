import type { Player } from '../types/player';
import { resolveStayStart } from './algorithm';

export interface GamesStats {
  max: number;
  min: number;
  median: number;
}

/** 試合数の max / min / median。空配列は null。 */
export function computeGamesStats(players: ReadonlyArray<Pick<Player, 'gamesPlayed'>>): GamesStats | null {
  if (players.length === 0) return null;
  const sorted = players.map((p) => p.gamesPlayed).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { max: sorted[sorted.length - 1], min: sorted[0], median };
}

/** 中央値の表示（整数はそのまま、小数は1桁）。 */
export function formatMedian(median: number): string {
  return Number.isInteger(median) ? String(median) : median.toFixed(1);
}

export interface StayInfo {
  /** 会費・名簿が両方完了しているか（未完了は滞在0扱い） */
  complete: boolean;
  /** 滞在分（下限なし、0 以上） */
  minutes: number;
  /** 最長滞在者を100%とした割合（整数%）。最大滞在が0なら null */
  percent: number | null;
}

export interface StayStats {
  maxMinutes: number;
  byId: Map<string, StayInfo>;
}

/** 滞在時間モードのアルゴリズム（resolveStayStart）と同じ起点で各人の滞在分と割合を求める。 */
export function computeStayStats(
  players: ReadonlyArray<Player>,
  practiceStartTime: number,
  now: number,
): StayStats {
  const raw = players.map((p) => {
    const complete = p.operationStatus?.payment === true && p.operationStatus?.roster === true;
    const start = resolveStayStart(p, practiceStartTime, now);
    return { id: p.id, complete, minutes: Math.max(0, (now - start) / 60000) };
  });
  const maxMinutes = raw.reduce((m, r) => Math.max(m, r.minutes), 0);
  const byId = new Map<string, StayInfo>();
  for (const r of raw) {
    byId.set(r.id, {
      complete: r.complete,
      minutes: r.minutes,
      percent: maxMinutes > 0 ? Math.round((r.minutes / maxMinutes) * 100) : null,
    });
  }
  return { maxMinutes, byId };
}

/** 分 → `H:MM`（例: 83 → 1:23） */
export function formatStayMinutes(minutes: number): string {
  const total = Math.floor(minutes);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
