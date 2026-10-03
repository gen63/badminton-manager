/**
 * 後半均等化（lateBalanceMode）の自動 ON 時刻。
 * 詳細: docs/plans/2026-10-03-late-balance-auto-on-before-end.md
 */

/** 練習終了の何分前に自動 ON するか */
export const LATE_BALANCE_BEFORE_END_MIN = 60;
/** 終了時刻が無い旧セッション用: 練習開始から何分後に自動 ON するか */
export const LATE_BALANCE_AFTER_START_MIN = 120;

/**
 * 自動 ON の発火時刻 (ms)。終了時刻があれば「終了の 60 分前」、無ければ
 * 「開始 + 120 分」。開始時刻が無ければ null。
 */
export function getLateBalanceAutoOnTime(config: {
  practiceStartTime?: number;
  practiceEndTime?: number;
}): number | null {
  if (config.practiceEndTime) {
    return config.practiceEndTime - LATE_BALANCE_BEFORE_END_MIN * 60 * 1000;
  }
  if (config.practiceStartTime) {
    return config.practiceStartTime + LATE_BALANCE_AFTER_START_MIN * 60 * 1000;
  }
  return null;
}
