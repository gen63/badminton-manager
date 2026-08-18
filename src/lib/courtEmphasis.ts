/**
 * 試合の経過時間に応じたコート枠の強調レベル。
 *
 * 長引いている試合を一目で見つけられるよう、コートカードの外枠を段階的に
 * 強調する。純粋関数として切り出し、時刻の取得（`Date.now()`）は
 * 呼び出し側（`useCourtEmphasisLevel`）に任せる。
 */

/**
 * 外枠を太くする経過時間の閾値（4分30秒）。
 * 事前呼び出し通知の `MATCH_CALL_THRESHOLD_MS` と同じ時刻で、
 * 「そろそろ終わる／次の人を呼ぶ」タイミングを枠でも示す。
 */
export const COURT_EMPHASIS_THICK_MS = 4.5 * 60 * 1000;

/**
 * 外枠を点滅させる経過時間の閾値（6分）。
 * 実測の試合時間中央値が約6.5分のため、6分超は「長め」の目安になる。
 */
export const COURT_EMPHASIS_BLINK_MS = 6 * 60 * 1000;

/**
 * コート枠の強調レベル。
 * - `none`: 通常（未開始・4分30秒未満）
 * - `thick`: 外枠を太く強調
 * - `blink`: 外枠を太くしたうえで点滅
 */
export type CourtEmphasisLevel = 'none' | 'thick' | 'blink';

/**
 * 試合開始時刻と現在時刻から強調レベルを求める。
 * `startedAt` が 0 以下（未開始・旧データ）や未来の場合は `none`。
 */
export function getCourtEmphasisLevel(startedAt: number, now: number): CourtEmphasisLevel {
  if (!startedAt || startedAt <= 0) return 'none';
  const elapsed = now - startedAt;
  if (elapsed >= COURT_EMPHASIS_BLINK_MS) return 'blink';
  if (elapsed >= COURT_EMPHASIS_THICK_MS) return 'thick';
  return 'none';
}

/**
 * 次に強調レベルが変わるまでの待ち時間（ms）。最終段階（`blink`）に達していれば
 * `null`（以降タイマー不要）。毎秒 tick する代わりに閾値ちょうどで1回だけ
 * 再レンダリングさせるために使う。
 */
export function getNextCourtEmphasisDelay(startedAt: number, now: number): number | null {
  if (!startedAt || startedAt <= 0) return null;
  const elapsed = now - startedAt;
  if (elapsed < COURT_EMPHASIS_THICK_MS) return COURT_EMPHASIS_THICK_MS - elapsed;
  if (elapsed < COURT_EMPHASIS_BLINK_MS) return COURT_EMPHASIS_BLINK_MS - elapsed;
  return null;
}
