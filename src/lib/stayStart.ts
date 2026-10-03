import type { Player } from '../types/player';

// algorithm.ts（配置）と playerStats.ts（表示用の統計・期待試合数）の両方から使うため、
// 循環 import を避けて独立モジュールに置く。

/**
 * 滞在時間モードでの「滞在開始時刻」を決定する。
 *
 * 会費・名簿が未対応のまま滞在時間だけが積み上がり、対応済みの人より
 * 優先されてしまう不公平を避けるため、起点は「休憩解除時刻」ではなく
 * 「会費・名簿が両方完了した時刻」を基準にする。3ケース:
 *
 * 1. 会費・名簿とも完了 & `opsCompletedAt` あり
 *    → `max(practiceStartTime, opsCompletedAt)`
 * 2. 会費・名簿とも完了 & `opsCompletedAt` なし（このフィールド追加前に
 *    完了した既存セッション互換）→ `max(practiceStartTime, activatedAt ?? now)`（従来どおり）
 * 3. 会費・名簿のどちらか未完了
 *    → `now`（＝滞在時間ゼロ扱い。下限5分ペナルティが効く）
 *
 * 詳細: docs/plans/2026-08-11-stay-start-at-ops-complete.md
 */
export function resolveStayStart(player: Player, practiceStartTime: number, now: number): number {
  const opsComplete = player.operationStatus?.payment === true && player.operationStatus?.roster === true;
  if (!opsComplete) {
    return now;
  }
  if (player.opsCompletedAt !== undefined) {
    return Math.max(practiceStartTime, player.opsCompletedAt);
  }
  return Math.max(practiceStartTime, player.activatedAt ?? now);
}
