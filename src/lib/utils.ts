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
  delimiter: RegExp = /\t|\s{2,}/
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
 * ルール: 待機人数（参加人数 - コート数×4）が2人以上になる最大コート数
 */
export function getRecommendedCourtCount(playerCount: number, maxCourts: number = 3): number {
  for (let courts = maxCourts; courts >= 1; courts--) {
    if (playerCount - courts * 4 >= 2) {
      return courts;
    }
  }
  return 1;
}

/**
 * 流動優先モードのブロック判定ユーティリティ。
 *
 * @param prioritizeRotation 流動優先モードかどうか
 * @param occupiedCourts 目前でプレー中またはプレイヤーが入っているコート数
 * @param emptyCourts 空いているコート数
 * @param waitingCount 待機中のプレイヤー人数（コート内に入っていないアクティブプレイヤー）
 * @param totalActiveCount アクティブ（休憩中でない）プレイヤーの総数
 * @param baseThreshold ブロックするための基本待機人数閾値（従来は3／7など）
 *
 * ブロックされる条件:
 *   1. 流動優先モードが有効
 *   2. 少なくとも1コートはプレー中かプレイヤー割り当て済みかつ
 *      1コート以上が空いている
 *   3. 待機人数が baseThreshold 未満 または
 *      総アクティブ人数がコートキャパシティ（totalCourts×4）に
 *      等しく、かつまだ全コートが空いていない（＝空きが1つ以上）
 *
 * この2番目の追加条件により「2コート8人のとき、1コートだけが
 * 終了して待機4人になるケース」などをブロックできる。
 */
export function shouldBlockForRotation(
  prioritizeRotation: boolean,
  occupiedCourts: number,
  emptyCourts: number,
  waitingCount: number,
  totalActiveCount: number,
  baseThreshold: number
): boolean {
  if (!prioritizeRotation) return false;
  if (occupiedCourts === 0 || emptyCourts === 0) return false;

  const remainingAfterAssignment = Math.max(0, waitingCount - (emptyCourts * 4));
  if (remainingAfterAssignment < baseThreshold) {
    return true;
  }

  const totalCourts = occupiedCourts + emptyCourts;
  const maxCapacity = totalCourts * 4;
  if (totalActiveCount >= maxCapacity) {
    return true;
  }

  return false;
}
