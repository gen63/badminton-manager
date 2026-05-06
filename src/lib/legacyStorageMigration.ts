/**
 * 過去フェーズで削除した zustand persist キー / 廃止された永続化キーを
 * localStorage から掃除する。
 *
 * Q2「既存 localStorage は破棄」の決定に従う。読み込まれることはないので機能影響は
 * 無いが、ユーザーの localStorage 容量を浪費するので 1 度だけ削除する。
 *
 * 段階:
 *  - v1 (Phase 3/4): `badminton-players` / `badminton-game` /
 *    `badminton-reservations` / `firebase_session_*`
 *  - v2 (Phase C / 2026-05-06): `accounting-storage`（accountingStore.records の
 *    persist 撤廃に伴う）。`badminton-session` 内の旧 `state.session` フィールドは
 *    sessionStore 側の `migrate(version: 1)` で剥がすのでここでは触らない。
 */
export function cleanupLegacyLocalStorage(): void {
  if (typeof localStorage === 'undefined') return;

  const FLAG_KEY = 'badminton-legacy-cleanup-v2';
  if (localStorage.getItem(FLAG_KEY) === '1') return;

  try {
    // v1: Phase 3 で persist 撤去したキー
    localStorage.removeItem('badminton-players');
    localStorage.removeItem('badminton-game');
    localStorage.removeItem('badminton-reservations');

    // v1: Phase 4 で廃止した localStorage セッション
    const prefix = 'firebase_session_';
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) toRemove.push(key);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));

    // v2 (Phase C / 2026-05-06): accountingStore の persist 撤廃
    localStorage.removeItem('accounting-storage');

    // 旧 v1 フラグも掃除（v2 に統合）
    localStorage.removeItem('badminton-legacy-cleanup-v1');

    localStorage.setItem(FLAG_KEY, '1');
  } catch (err) {
    // localStorage が無効化されているケース（プライベートブラウジング等）は無視
    console.warn('[legacyStorageMigration] cleanup failed:', err);
  }
}
