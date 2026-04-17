import type { Match } from '../types/match';
import type { Session } from '../types/session';

export const ARCHIVE_THRESHOLD_MS = 12 * 60 * 60 * 1000;

export function computeFirstMatchStartedAt(matches: Match[]): number | null {
  if (matches.length === 0) return null;
  return Math.min(...matches.map((m) => m.startedAt));
}

export function isSessionVisible(
  session: Pick<Session, 'firstMatchStartedAt'>,
  now: number = Date.now(),
): boolean {
  if (!session.firstMatchStartedAt) return true;
  return session.firstMatchStartedAt > now - ARCHIVE_THRESHOLD_MS;
}
