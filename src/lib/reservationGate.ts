import type { Player } from '../types/player';
import { computeExpectedGames, computeStayStats, type ExpectedGamesMode } from './playerStats';

/**
 * 予約の「期待差ゲート」。
 *
 * 期待試合数との差（実績 − 期待）が閾値 B 以上のメンバーがいる予約は保留する。
 * 配置アルゴリズム（algorithm.ts）と予約追加 UI（PlayerPickList）の判定を同じ関数に揃える。
 * 詳細: docs/plans/2026-10-03-reservation-expected-diff-gate.md
 */

/** ボーダー B（期待差。差を小数1桁に丸めた値 ≥ B で該当）。設定では変えられない固定値 */
export const RESERVATION_EXPECTED_DIFF_LIMIT = 1.5;

/**
 * 差が閾値以上か。表示（formatDiff）と同じ小数1桁に丸めてから比べる。
 * 期待が算出できない（null / undefined）は対象外（false）。
 */
export function isOverExpectedDiff(diff: number | null | undefined, threshold: number): boolean {
  if (diff === null || diff === undefined) return false;
  return Math.round(diff * 10) / 10 >= threshold;
}

export interface ExpectedDiffInput {
  /** セッションの全 players（表示と同じ母集団） */
  players: ReadonlyArray<Player>;
  /** 滞在時間モード（settings.useStayDurationPriority）なら true、回数平均モードなら false */
  useStayDuration: boolean;
  practiceStartTime: number;
  practiceEndTime?: number;
  now: number;
}

/**
 * 各人の期待差（実績 − 期待）。期待が算出できない人は null。
 * 表示（usePlayerGameStats）と同じ computeStayStats / computeExpectedGames を通す。
 */
export function computeExpectedDiffById(input: ExpectedDiffInput): Map<string, number | null> {
  const { players, useStayDuration, practiceStartTime, practiceEndTime, now } = input;
  const mode: ExpectedGamesMode = useStayDuration ? 'stay' : 'count';
  const stay = computeStayStats(players, practiceStartTime, now, practiceEndTime);
  const expected = computeExpectedGames(players, mode, stay.byId);
  const result = new Map<string, number | null>();
  for (const p of players) result.set(p.id, expected.get(p.id)?.diff ?? null);
  return result;
}

/** 期待差 ≥ B のメンバー ID（予約メンバーの順）。 */
export function overExpectedMemberIds(
  memberIds: ReadonlyArray<string>,
  diffById: ReadonlyMap<string, number | null>,
  threshold: number = RESERVATION_EXPECTED_DIFF_LIMIT,
): string[] {
  return memberIds.filter((id) => isOverExpectedDiff(diffById.get(id), threshold));
}

/** メンバーの誰かが期待差 ≥ B か。 */
export function hasOverExpectedMember(
  memberIds: ReadonlyArray<string>,
  diffById: ReadonlyMap<string, number | null>,
  threshold: number = RESERVATION_EXPECTED_DIFF_LIMIT,
): boolean {
  return overExpectedMemberIds(memberIds, diffById, threshold).length > 0;
}

/**
 * 予約が期待差で保留されるか。割り振り（algorithm）と予約一覧の表示で共用する。
 * 作成者が「優先」にした予約（forcePriority）は保留しない。
 */
export function isReservationHeldByExpectedDiff(
  reservation: { playerIds: ReadonlyArray<string>; forcePriority?: boolean },
  diffById: ReadonlyMap<string, number | null>,
): boolean {
  if (reservation.forcePriority === true) return false;
  return hasOverExpectedMember(reservation.playerIds, diffById);
}

/**
 * 予約追加 UI での行の扱い。
 * - free: 制限なし
 * - blocked: 作成者以外は選択不可（期待差 ≥ B）
 * - warn: 作成者は選択できるが、保留される旨を表示
 */
export type ReservationPickState = 'free' | 'blocked' | 'warn';

export function getReservationPickState(
  diff: number | null | undefined,
  isCreator: boolean,
  threshold: number = RESERVATION_EXPECTED_DIFF_LIMIT,
): ReservationPickState {
  if (!isOverExpectedDiff(diff, threshold)) return 'free';
  return isCreator ? 'warn' : 'blocked';
}
