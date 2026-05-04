/**
 * Firestore 操作で繰り返し使う小ユーティリティ。
 *
 * Phase 5 で `sessionService.ts` / `sessionMutations.ts` / `useFirebaseSync.ts`
 * 等に散在していた同等ロジックをここに集約した。
 */

import { db } from './firebase';
import { SessionError } from './errorHandler';

/**
 * Firebase が初期化されていることを保証して `db` を返す。
 * 未設定なら `SessionError('firebase-not-configured')` を throw する。
 *
 * 例外を伝播させたくない fire-and-forget 用途（presence 系等）では
 * 直接 `if (!db) return` を使うこと。
 */
export function requireDb() {
  if (!db) {
    throw new SessionError(
      'Firebase が初期化されていません。設定を確認してください。',
      'firebase-not-configured',
    );
  }
  return db;
}

/**
 * Firestore は `undefined` を受け付けないため、書き込み前に deep clone でフィルタする。
 * 配列 / プレーンオブジェクトのみを想定。Date / Map 等は壊れる点に注意。
 */
export function sanitize<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Firestore の `Timestamp` / number / `{ seconds }` から ms を取り出す。
 * 解釈できない値は 0。
 */
export function timestampToMillis(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const seconds = (value as { seconds?: number }).seconds;
    if (typeof seconds === 'number') return seconds * 1000;
  }
  return 0;
}
