import type { Match } from '../types/match';

/** 最後の試合開始からこの時間が経過したセッションは一覧から自動的に隠す */
export const ARCHIVE_THRESHOLD_MS = 3 * 60 * 60 * 1000;

/** 試合未開始セッションを一覧に出し始めるリードタイム（開始時刻からの遡り） */
export const VISIBLE_BEFORE_START_MS = 90 * 60 * 1000;

export function computeLastMatchStartedAt(matches: Match[]): number | null {
  if (matches.length === 0) return null;
  return Math.max(...matches.map((m) => m.startedAt));
}

/** タイムスタンプ(ms)を YYYY-MM-DD 文字列に変換（ローカル時刻） */
export function formatLocalDate(timestamp: number): string {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isSessionVisible(
  session: {
    lastMatchStartedAt?: number | null;
    config?: { practiceStartTime?: number };
  },
  now: number = Date.now(),
): boolean {
  if (session.lastMatchStartedAt) {
    return session.lastMatchStartedAt > now - ARCHIVE_THRESHOLD_MS;
  }
  const startTime = session.config?.practiceStartTime;
  if (!startTime) return false;
  // 開始時刻の手前は VISIBLE_BEFORE_START_MS（90分）以内でないと非表示
  if (now < startTime - VISIBLE_BEFORE_START_MS) return false;
  return formatLocalDate(startTime) >= formatLocalDate(now);
}
