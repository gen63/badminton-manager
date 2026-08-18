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
 * セッション参加 URL を組み立てる。
 *
 * 共有 UI は 2026-05-07 に撤去したが、一覧の自動非表示（最後の試合から30分）で
 * 見つけられなくなったメンバーへ連携するための緊急避難措置として設定画面に復活させた。
 * `base` は BrowserRouter の basename と同じ `import.meta.env.BASE_URL` を渡す想定で、
 * 前後のスラッシュ有無に関わらず `<origin>/<base>/session/<id>` になるよう正規化する。
 */
export function buildSessionUrl(origin: string, base: string, sessionId: string): string {
  const trimmedOrigin = origin.replace(/\/+$/, '');
  const trimmedBase = base.replace(/^\/+|\/+$/g, '');
  const prefix = trimmedBase ? `${trimmedOrigin}/${trimmedBase}` : trimmedOrigin;
  return `${prefix}/session/${sessionId}`;
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

/** 一括配置強制モードの3状態ゲート。 */
export type AssignmentGate = 'free' | 'waiting' | 'bulkOnly';

/**
 * 一括配置強制モードの3状態ゲート判定。
 *
 * @param forceBulkAssignment 一括配置強制モードかどうか
 * @param occupiedCourts 現在プレー中またはプレイヤーが入っているコート数
 * @param emptyCourts 空いているコート数
 * @param waitingCount 待機中のプレイヤー人数（コート内に入っていないアクティブプレイヤー）
 * @param playersPerCourt 1コートあたりの人数（通常は4、シングルスは2）
 * @param baseThreshold ブロックするための基本待機人数閾値（通常は2）
 *
 * 状態:
 *   - `free`: 通常。従来通り1面ずつ即配置してよい。
 *   - `waiting`（待機中）: thin かつ空き1面かつ他コートに人がいる。他コート終了待ち。
 *     一括ボタンも無効（空き1面での一括は per-court と同じ動作になるため抜け道になる）。
 *   - `bulkOnly`（一括のみ）: thin かつ空き2面以上。一括ボタンで2面まとめて配置する。
 *
 * `emptyCourts === 1 && occupiedCourts === 0`（1コートセッション）は待つ相手がいないので
 * `free` を返す。
 *
 * 【設計根拠：多様性確率】
 * 1コート空き時、待機 w 人 + 直前対戦の 4 人 = w+4 人プールから 4 人選抜する。
 * 最適選抜（待機優先）での強制再投入数 = max(0, 4 - w):
 *   w=0: 4人(100%) / w=1: 3人(75%) / w=2: 2人(50%) /
 *   w=3: 1人(25%) / w=4以上: 0人(0%)
 * → baseThreshold=2 のとき「強制再投入 ≥ 50%」の境界でブロック。
 *
 * 一般式:
 *   thin: waitingCount - emptyCourts × playersPerCourt ≤ baseThreshold
 *
 * 解除条件は「プレイ中0面」ではなく「空き2面」。一括配置に意味があるのは空き2面以上
 * のときだけなので、止めるべきは空き1面のときだけで、2面空いた時点で即解除する。
 */
export function getAssignmentGate(
  forceBulkAssignment: boolean,
  occupiedCourts: number,
  emptyCourts: number,
  waitingCount: number,
  playersPerCourt: number = 4,
  baseThreshold: number = 2,
): AssignmentGate {
  if (!forceBulkAssignment) return 'free';
  if (emptyCourts === 0) return 'free'; // 配置対象がない
  const thin = waitingCount - emptyCourts * playersPerCourt <= baseThreshold;
  if (!thin) return 'free';
  if (emptyCourts === 1) return occupiedCourts > 0 ? 'waiting' : 'free';
  return 'bulkOnly';
}
