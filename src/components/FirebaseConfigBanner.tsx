import { isFirebaseConfigured } from '../lib/firebase';

/**
 * Firebase 未設定時に画面上部に永続的に表示する警告バナー。
 *
 * Phase 4 で Firebase が必須になったので、`.env` の `VITE_FIREBASE_*` が
 * 設定されていないとアプリは事実上機能しない。本番ユーザー向けに見える形で
 * 設定漏れを通知する。
 */
export function FirebaseConfigBanner() {
  if (isFirebaseConfigured()) return null;
  return (
    <div className="bg-red-600 text-white text-xs px-3 py-2 text-center font-medium">
      Firebase が設定されていません。アプリは動作しません。
      管理者は <code className="font-mono bg-red-700 px-1 rounded">.env</code> の{' '}
      <code className="font-mono bg-red-700 px-1 rounded">VITE_FIREBASE_*</code> を確認してください。
    </div>
  );
}
