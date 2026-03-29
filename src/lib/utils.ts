import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Tailwind CSS class names merger
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format date to Japanese format
 */
export function formatDate(date: Date | number): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  return d.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * Format time to HH:MM format
 */
export function formatTime(date: Date | number): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  return d.toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format duration in minutes
 */
export function formatDuration(startMs: number, endMs: number): string {
  const minutes = Math.floor((endMs - startMs) / 60000);
  return `${minutes}分`;
}

/**
 * Generate session ID
 */
export function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * プレイヤー入力行をパース
 * "名前 性別 レーティング" の組み合わせ（順不同）
 * 性別: M/F/男/女
 * delimiter: フィールド区切りの正規表現
 *   - 複数行入力（textarea）: /\t|\s{2,}/（タブ or 2+スペース）
 *   - 単一行入力（inline）: /\s+/（任意スペース）
 */
export function parsePlayerInput(
  line: string,
  delimiter: RegExp = /\t|\s+/
): { name: string; rating?: number; gender?: 'M' | 'F' } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(delimiter);
  const name = parts[0].trim();
  if (!name) return null;

  let rating: number | undefined;
  let gender: 'M' | 'F' | undefined;

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].trim();
    const upper = part.toUpperCase();
    if (upper === 'M' || part === '男') {
      gender = 'M';
    } else if (upper === 'F' || part === '女') {
      gender = 'F';
    } else {
      const num = parseInt(part, 10);
      if (!isNaN(num)) {
        rating = num;
      }
    }
  }

  return { name, rating, gender };
}

/**
 * 参加人数に応じた推奨コート数を算出
 * ルール: 待機人数（参加人数 - コート数×playersPerCourt）が2人以上になる最大コート数
 */
export function getRecommendedCourtCount(playerCount: number, maxCourts: number = 3, playersPerCourt: number = 4): number {
  for (let courts = maxCourts; courts >= 1; courts--) {
    if (playerCount - courts * playersPerCourt >= 2) {
      return courts;
    }
  }
  return 1;
}

/**
 * 多様性優先モードのブロック判定ユーティリティ。
 *
 * @param prioritizeDiversity 多様性優先モードかどうか
 * @param occupiedCourts 目前でプレー中またはプレイヤーが入っているコート数
 * @param emptyCourts 空いているコート数
 * @param waitingCount 待機中のプレイヤー人数（コート内に入っていないアクティブプレイヤー）
 * @param totalActiveCount アクティブ（休憩中でない）プレイヤーの総数
 * @param baseThreshold ブロックするための基本待機人数閾値（通常は2）
 *
 * 推奨メッセージを表示する条件:
 *   1. 多様性優先モードが有効
 *   2. エッジケース除外：3コート以上全空きの場合は推奨なし（1コートずつ配置OK）
 *   3. 空きコートを埋めた後（または仮に1コート空いた場合）の待機人数が baseThreshold 以下
 *   ※ 空きコートがない場合も、次に空いたときの予告として表示
 *
 * 多様性優先モードの意図: 組み合わせの多様性を高めるため複数コート一括配置を促す
 *
 * 【実際の動作範囲】
 * baseThreshold=2 の場合：
 *   2コート（全空き or 1使用中+1空き）:
 *     - ブロック発動: 8-10人（全空き時）、4-6人待機（1コート使用中）
 *     - ブロック解除: 11人以上（全空き時）、7人以上待機（1コート使用中）
 *   3コート（全空き or 2使用中+1空き）:
 *     - ブロック発動: 12-14人（全空き時）、4-6人待機（2コート使用中）
 *     - ブロック解除: 15人以上（全空き時）、7人以上待機（2コート使用中）
 *
 * 一般式:
 *   ブロック発動: waitingCount ≤ emptyCourts × 4 + baseThreshold
 *   ブロック解除: waitingCount > emptyCourts × 4 + baseThreshold
 */
export function shouldBlockForDiversity(
  prioritizeDiversity: boolean,
  occupiedCourts: number,
  emptyCourts: number,
  waitingCount: number,
  _totalActiveCount: number,
  baseThreshold: number,
  playersPerCourt: number = 4
): boolean {
  if (!prioritizeDiversity) return false;

  // エッジケース：3コート以上全空きの場合は推奨なし
  const totalCourts = occupiedCourts + emptyCourts;
  if (totalCourts >= 3 && occupiedCourts === 0) {
    return false;
  }

  // 空きコートがない場合は、仮に1コート空くとして計算
  const effectiveEmptyCourts = Math.max(emptyCourts, 1);

  const remainingAfterAssignment = Math.max(0, waitingCount - (effectiveEmptyCourts * playersPerCourt));
  if (remainingAfterAssignment <= baseThreshold) {
    return true;
  }

  return false;
}
