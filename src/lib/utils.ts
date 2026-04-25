import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Player } from '../types/player';

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
 * Copy text to clipboard (with legacy fallback for older browsers)
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const input = document.createElement('input');
      input.value = text;
      document.body.appendChild(input);
      input.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(input);
      return ok;
    } catch {
      return false;
    }
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
 * ペア内の選手IDを「強さ順」で安定的に並び替える（表示用）
 *
 * 並び基準:
 *  1. Player.rating の降順（高レーティング = 強い）
 *  2. 同点は Player.name の localeCompare('ja') 昇順
 *  3. 該当プレイヤーが見つからない／空文字IDは末尾扱い
 *
 * 注意: データモデル（Match.teamA/teamB の格納順）は変更しない。
 * あくまで表示時にこの関数で並び替える。
 */
export function sortPairByStrength(
  pair: readonly [string, string],
  players: readonly Player[]
): [string, string] {
  const [a, b] = pair;
  const compare = comparePlayerStrength(a, b, players);
  return compare <= 0 ? [a, b] : [b, a];
}

/**
 * ペアを「強さ順」で並べた上で、元の配列インデックスも返す
 *
 * クリック可能な選手UI（コート上で位置情報を必要とする操作: 入れ替え等）で利用する。
 * 戻り値の順は表示順（強い順）、`index` は `pair` 配列での元位置（0 または 1）。
 */
export function sortPairWithIndex(
  pair: readonly [string, string],
  players: readonly Player[]
): Array<{ id: string; index: 0 | 1 }> {
  const compare = comparePlayerStrength(pair[0], pair[1], players);
  const entries: Array<{ id: string; index: 0 | 1 }> = [
    { id: pair[0], index: 0 },
    { id: pair[1], index: 1 },
  ];
  return compare <= 0 ? entries : [entries[1], entries[0]];
}

function comparePlayerStrength(
  idA: string,
  idB: string,
  players: readonly Player[]
): number {
  const pa = idA ? players.find((p) => p.id === idA) : undefined;
  const pb = idB ? players.find((p) => p.id === idB) : undefined;

  // 見つからない / 空文字は末尾
  if (!pa && !pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;

  const ra = pa.rating ?? 0;
  const rb = pb.rating ?? 0;
  if (ra !== rb) return rb - ra; // 降順

  return pa.name.localeCompare(pb.name, 'ja');
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
