import { useSyncStatusStore } from '../stores/syncStatusStore';

/**
 * `useFirebaseSync` の onSnapshot エラーを永続的に表示するバナー（ERR2）。
 *
 * Toast は数秒で消えてしまい、長時間切断状態に気づけないため、画面上部に
 * 留まるバナーで「リロード」ボタン付きで再接続を促す。再受信が成功すると
 * `useFirebaseSync` 側で自動的にバナーがクリアされる。
 */
export function SyncErrorBanner() {
  const syncError = useSyncStatusStore((s) => s.syncError);
  if (!syncError) return null;
  return (
    <div className="bg-amber-500 text-white text-xs px-3 py-2 flex items-center justify-between gap-3">
      <span>
        <span className="font-semibold">同期切断</span>
        <span className="ml-2 opacity-90">{syncError}</span>
      </span>
      <button
        onClick={() => window.location.reload()}
        className="bg-amber-600 hover:bg-amber-700 rounded px-2 py-1 text-xs font-medium"
      >
        リロード
      </button>
    </div>
  );
}
