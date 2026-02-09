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
