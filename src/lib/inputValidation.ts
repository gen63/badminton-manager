/**
 * 入力検証ユーティリティ。
 *
 * Phase 8 SEC2/SEC3 で追加。本アプリは認証なしで動くため、入力 sanitization は
 * クライアントだけで行う。攻撃面は限定的（信頼グループ前提）だが、長大な
 * 文字列・制御文字・改行で UI が崩れたり Firestore document size limit
 * （1MB/doc）を超えるのを防ぐためのガード。
 */

/** プレイヤー名の最大長（UTF-16 単位） */
export const MAX_PLAYER_NAME_LENGTH = 32;

/** セッション ID は大文字英数字 */
const SESSION_ID_REGEX = /^[A-Z0-9]{6}$/;

/**
 * 削除対象の不可視文字。
 *   - C0 制御 (U+0000–U+001F)
 *   - DEL (U+007F)
 *   - C1 制御 (U+0080–U+009F)
 *   - zero-width / 方向指定 (U+200B–U+200F)
 *   - BOM (U+FEFF)
 *
 * RegExp コンストラクタで \u エスケープ列から構築する（lint が
 * source の literal 不可視文字を irregular whitespace として弾くため）。
 */
const INVISIBLE_CHARS_REGEX = new RegExp(
  '[' + '\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\uFEFF' + ']',
  'g',
);

/**
 * プレイヤー名を sanitize する。
 *
 * - 制御文字 / zero-width を除去
 * - 前後の whitespace を除去
 * - `MAX_PLAYER_NAME_LENGTH` で打ち切る
 * - 結果が空なら `null` を返す
 */
export function sanitizePlayerName(raw: string): string | null {
  const cleaned = raw.replace(INVISIBLE_CHARS_REGEX, '').trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_PLAYER_NAME_LENGTH
    ? cleaned.slice(0, MAX_PLAYER_NAME_LENGTH)
    : cleaned;
}

/** プレイヤー名が有効かを判定（sanitize は別途必要） */
export function isValidPlayerName(name: string): boolean {
  return sanitizePlayerName(name) !== null;
}

/** セッション ID の形式チェック（6 文字英数大文字） */
export function isValidSessionId(id: string): boolean {
  return SESSION_ID_REGEX.test(id);
}
