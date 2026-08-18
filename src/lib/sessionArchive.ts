import type { Match } from '../types/match';
import type { Court } from '../types/court';

export const ARCHIVE_THRESHOLD_MS = 12 * 60 * 60 * 1000;

/** 試合未開始セッションを一覧に出し始めるリードタイム（開始時刻からの遡り） */
export const VISIBLE_BEFORE_START_MS = 90 * 60 * 1000;

/** 最後の試合が終わってから一覧に残す時間 */
export const VISIBLE_AFTER_LAST_MATCH_MS = 30 * 60 * 1000;

export function computeFirstMatchStartedAt(matches: Match[]): number | null {
  if (matches.length === 0) return null;
  return Math.min(...matches.map((m) => m.startedAt));
}

/**
 * 最後に終わった試合の終了時刻。終了時刻を持つ試合が無ければ null。
 *
 * 一覧の「最後の試合から30分」判定用。`finishedAt` が 0 / 未設定の試合は
 * 「終了時刻不明」として無視する（0 を max に混ぜると判定が壊れるため）。
 */
export function computeLastMatchFinishedAt(matches: Match[]): number | null {
  const finished = matches
    .map((m) => m.finishedAt)
    .filter((t): t is number => typeof t === 'number' && t > 0);
  if (finished.length === 0) return null;
  return Math.max(...finished);
}

/**
 * コートに試合が進行中（または配置済み）か。
 *
 * 配置直後で「開始」がまだ押されていないコートも進行中として扱う
 * （`MATCH_AUTO_START_MS` 経過で自動開始されるため）。判定基準は
 * `gameOperations.ts` の `occupied` と揃えている。
 */
export function computeHasActiveCourt(courts: Court[]): boolean {
  return courts.some((c) => c.isPlaying || !!c.teamA?.[0]);
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
    firstMatchStartedAt?: number | null;
    lastMatchFinishedAt?: number | null;
    hasActiveCourt?: boolean;
    config?: { practiceStartTime?: number };
  },
  now: number = Date.now(),
): boolean {
  if (session.firstMatchStartedAt) {
    // 絶対上限。「試合終了」を押さずに解散してコートが進行中のまま残ったセッションが
    // hasActiveCourt で永久に一覧へ居座るのを防ぐ。
    if (session.firstMatchStartedAt <= now - ARCHIVE_THRESHOLD_MS) return false;
    // 練習中（休憩明けの再開直後を含む）は無条件で表示
    if (session.hasActiveCourt) return true;
    // 終了時刻を持つ試合が 1 つも無い場合は従来どおり 12h 判定にフォールバック
    if (!session.lastMatchFinishedAt) return true;
    return session.lastMatchFinishedAt > now - VISIBLE_AFTER_LAST_MATCH_MS;
  }
  const startTime = session.config?.practiceStartTime;
  if (!startTime) return false;
  // 開始時刻の手前は VISIBLE_BEFORE_START_MS（90分）以内でないと非表示
  if (now < startTime - VISIBLE_BEFORE_START_MS) return false;
  return formatLocalDate(startTime) >= formatLocalDate(now);
}

/**
 * 練習が終わったのでセッションから自動退出すべきか。
 *
 * 判定は一覧の非表示条件（`isSessionVisible`）と同じものを使うが、**試合開始済みの
 * セッションだけ**を対象にする。試合未開始の「開始90分前まで非表示」は
 * *一覧に出さない* だけのルールで（`docs/plans/2026-05-19-hide-sessions-until-90min-before-start.md`）、
 * 開始前に入っている作成者や早く来た人を追い出す意図ではないため対象外。
 */
export function shouldAutoExitSession(
  session: {
    firstMatchStartedAt?: number | null;
    lastMatchFinishedAt?: number | null;
    hasActiveCourt?: boolean;
    config?: { practiceStartTime?: number };
  },
  now: number = Date.now(),
): boolean {
  if (!session.firstMatchStartedAt) return false;
  return !isSessionVisible(session, now);
}
