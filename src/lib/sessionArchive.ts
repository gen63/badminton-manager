import type { Match } from '../types/match';

export const ARCHIVE_THRESHOLD_MS = 12 * 60 * 60 * 1000;

export function computeFirstMatchStartedAt(matches: Match[]): number | null {
  if (matches.length === 0) return null;
  return Math.min(...matches.map((m) => m.startedAt));
}

/** `now` を YYYY-MM-DD 文字列に変換（ローカル時刻） */
function formatLocalDate(now: number): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isSessionVisible(
  session: {
    firstMatchStartedAt?: number | null;
    config?: { practiceDate?: string };
  },
  now: number = Date.now(),
): boolean {
  if (session.firstMatchStartedAt) {
    return session.firstMatchStartedAt > now - ARCHIVE_THRESHOLD_MS;
  }
  const practiceDate = session.config?.practiceDate;
  if (!practiceDate) return false;
  return practiceDate >= formatLocalDate(now);
}
