import { useSyncStatusStore } from '../stores/syncStatusStore';

/**
 * `useFirebaseSync` の onSnapshot エラーを永続的に表示するバナー（ERR2）。
 *
 * Toast は数秒で消えてしまい、長時間切断状態に気づけないため、画面上部に
 * 留まるバナーで表示し続ける。
 *
 * ボタンは 2 つ:
 *  - 「再接続」: ページをリロードせず onSnapshot だけ再購読する。
 *    `requestReconnect()` で `reconnectNonce` を increment し、`useFirebaseSync`
 *    の useEffect が unsubscribe → subscribe する。多くのケース（タブ復帰直後の
 *    stale WebSocket / 一時的なネット切断）はこれで復帰する。
 *  - 「リロード」: 最終手段。再接続でも回復しない場合や、JS バンドル更新後など。
 *
 * 再受信が成功すると `useFirebaseSync` 側で `setSyncError(null)` され、自動で
 * バナーは消える。
 */
export function SyncErrorBanner() {
  const syncError = useSyncStatusStore((s) => s.syncError);
  const requestReconnect = useSyncStatusStore((s) => s.requestReconnect);
  if (!syncError) return null;
  return (
    <div className="bg-amber-500 text-white text-xs px-3 py-2 flex items-center justify-between gap-3">
      <span>
        <span className="font-semibold">同期切断</span>
        <span className="ml-2 opacity-90">{syncError}</span>
      </span>
      <span className="flex items-center gap-2 shrink-0">
        <button
          onClick={requestReconnect}
          className="bg-amber-600 hover:bg-amber-700 rounded px-2 py-1 text-xs font-medium"
        >
          再接続
        </button>
        <button
          onClick={() => window.location.reload()}
          className="bg-amber-600 hover:bg-amber-700 rounded px-2 py-1 text-xs font-medium"
        >
          リロード
        </button>
      </span>
    </div>
  );
}
