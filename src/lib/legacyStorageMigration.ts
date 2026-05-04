/**
 * Phase 3 / Phase 4 で削除した zustand persist キーを localStorage から掃除する。
 *
 * Q2「既存 localStorage は破棄」の決定に従う。読み込まれることはないので機能影響は
 * 無いが、ユーザーの localStorage 容量を浪費するので 1 度だけ削除する。
 *
 * `firebase_session_*` は Phase 4 で書き込みも廃止したが、過去のオフラインモード
 * セッションが残っている可能性があるので、まとめて掃除する。
 */
export function cleanupLegacyLocalStorage(): void {
  if (typeof localStorage === 'undefined') return;

  const FLAG_KEY = 'badminton-legacy-cleanup-v1';
  if (localStorage.getItem(FLAG_KEY) === '1') return;

  try {
    // Phase 3 で persist 撤去したキー
    localStorage.removeItem('badminton-players');
    localStorage.removeItem('badminton-game');
    localStorage.removeItem('badminton-reservations');

    // Phase 4 で廃止した localStorage セッション
    const prefix = 'firebase_session_';
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) toRemove.push(key);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));

    localStorage.setItem(FLAG_KEY, '1');
  } catch (err) {
    // localStorage が無効化されているケース（プライベートブラウジング等）は無視
    console.warn('[legacyStorageMigration] cleanup failed:', err);
  }
}
