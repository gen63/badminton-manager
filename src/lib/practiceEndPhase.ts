/**
 * 練習終了時刻に向けた進行段階。
 *
 * 運用ルール: 終了20分前を過ぎたら新しい試合は入れない（連続モードも止める）、
 * 終了15分前で完全終了（片付け）。純粋関数として切り出し、時刻の取得
 * （`Date.now()`）は呼び出し側に任せる。
 * 詳細: docs/plans/2026-09-26-practice-end-time.md
 */

/** 新しい試合を入れなくなる、終了時刻からの残り時間（20分）。 */
export const PRACTICE_LAST_CALL_MS = 20 * 60 * 1000;

/** 完全終了（片付け）とする、終了時刻からの残り時間（15分）。 */
export const PRACTICE_CLOSED_MS = 15 * 60 * 1000;

/**
 * - `normal`: 通常（終了時刻が未設定の旧セッションも常にこれ）
 * - `lastCall`: 終了20分前以降。新しい試合は入れない
 * - `closed`: 終了15分前以降。完全終了
 */
export type PracticeEndPhase = 'normal' | 'lastCall' | 'closed';

export function getPracticeEndPhase(
  practiceEndTime: number | undefined | null,
  now: number,
): PracticeEndPhase {
  if (!practiceEndTime || practiceEndTime <= 0) return 'normal';
  const remaining = practiceEndTime - now;
  if (remaining <= PRACTICE_CLOSED_MS) return 'closed';
  if (remaining <= PRACTICE_LAST_CALL_MS) return 'lastCall';
  return 'normal';
}

/**
 * 次に段階が切り替わる時刻（再描画タイマー用）。これ以上切り替わらない・
 * 終了時刻が未設定なら `null`。
 */
export function getNextPracticeEndPhaseChangeAt(
  practiceEndTime: number | undefined | null,
  now: number,
): number | null {
  if (!practiceEndTime || practiceEndTime <= 0) return null;
  const lastCallAt = practiceEndTime - PRACTICE_LAST_CALL_MS;
  if (now < lastCallAt) return lastCallAt;
  const closedAt = practiceEndTime - PRACTICE_CLOSED_MS;
  if (now < closedAt) return closedAt;
  return null;
}

/** 新しい試合の配置を止める段階か（`lastCall` / `closed`）。 */
export function isPastLastCall(phase: PracticeEndPhase): boolean {
  return phase !== 'normal';
}

/**
 * 練習開始日時の日付に `HH:MM` を載せた終了日時を返す。終了が開始以前になる
 * 場合（日付をまたぐ練習）は翌日扱いにする。形式不正は `null`。
 */
export function buildPracticeEndTime(practiceStartTime: number, hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  const date = new Date(practiceStartTime);
  date.setHours(hours, minutes, 0, 0);
  let end = date.getTime();
  if (end <= practiceStartTime) end += 24 * 60 * 60 * 1000;
  return end;
}

/** 表示用 `HH:MM`（ローカル時刻）。 */
export function formatHHMM(time: number): string {
  const d = new Date(time);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 段階の切り替わりを読み上げてよい遅れの上限（60秒）。バックグラウンド中は
 * タイマーが間引かれ、復帰時に遅れて段階が切り替わる。とっくに過ぎた節目を
 * 復帰の瞬間に読み上げないよう、切り替え時刻からこれ以上遅れていたら鳴らさない。
 */
export const PRACTICE_END_ANNOUNCE_MAX_LATE_MS = 60 * 1000;

const PHASE_ORDER: Record<PracticeEndPhase, number> = { normal: 0, lastCall: 1, closed: 2 };

/**
 * アプリの動作中に段階が進んだ瞬間だけ読み上げる。初回表示（`prev` が無い）・
 * 段階が戻った（終了時刻の延長）・切り替えから時間が経っている場合は鳴らさない。
 */
export function shouldAnnouncePracticeEndPhase({
  prev,
  next,
  practiceEndTime,
  now,
}: {
  prev: PracticeEndPhase | null;
  next: PracticeEndPhase;
  practiceEndTime: number | undefined | null;
  now: number;
}): boolean {
  if (prev === null || !practiceEndTime || next === 'normal') return false;
  if (PHASE_ORDER[next] <= PHASE_ORDER[prev]) return false;
  const changedAt =
    practiceEndTime - (next === 'closed' ? PRACTICE_CLOSED_MS : PRACTICE_LAST_CALL_MS);
  return now - changedAt <= PRACTICE_END_ANNOUNCE_MAX_LATE_MS;
}

/** 段階の切り替わりで読み上げる文言。 */
export function buildPracticeEndAnnouncement(phase: 'lastCall' | 'closed'): string {
  return phase === 'closed'
    ? '練習終了の時間です。片付けをお願いします'
    : '練習終了20分前です。新しい試合は入れません';
}
