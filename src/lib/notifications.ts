/** Browser Notification API ユーティリティ */

/**
 * `NotificationOptions` には `vibrate` が定義されていないため、
 * ローカルで拡張した型を用いる（`any` は使わない）。
 */
type AppNotificationOptions = NotificationOptions & { vibrate?: number[] };

/** 通知が使える環境かどうか */
function isNotificationSupported(): boolean {
  return 'Notification' in window;
}

/** 通知許可をリクエスト */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNotificationSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  const result = await Notification.requestPermission();
  return result === 'granted';
}

/**
 * 通知を安全に表示する内部ヘルパー。
 *
 * `ServiceWorkerRegistration.showNotification()` を優先する。Chrome on Android
 * では `new Notification()` が `Illegal constructor` を throw するため
 * （仕様上 SW 経由が必須）、SW が使える場合はそちらに寄せる。
 *
 * `navigator.serviceWorker.ready` は SW 未登録だと永久に resolve しないため
 * 使わない。代わりに `getRegistration()` で登録済みか確認し、`active` が
 * あるときだけ SW 経由にする。
 *
 * SW が使えない・失敗した場合のみ `new Notification()` にフォールバックし、
 * これも try/catch で囲んで throw を握り潰す。呼び出し側には常に `void` を
 * 返し、失敗が一切伝播しないようにする（Promise rejection も含めて内部で処理）。
 */
function showNotificationSafely(title: string, options: AppNotificationOptions): void {
  void (async () => {
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration?.active) {
          await registration.showNotification(title, options);
          return;
        }
      }
    } catch (error) {
      console.error('[Notifications] showNotification via SW failed:', error);
    }

    try {
      new Notification(title, options);
    } catch (error) {
      // Chrome on Android 等、SW 未経由のコンストラクタが Illegal constructor を
      // throw する環境向けの最終防波堤。ここで握り潰して呼び出し側に伝播させない。
      console.error('[Notifications] Notification constructor fallback failed:', error);
    }
  })();
}

/**
 * 次の試合に入りそうなメンバーへの事前呼び出し通知を送信。
 * body の組み立ては呼び出し側（buildNextMatchCallMessage）の責務。
 */
export function notifyNextMatchSoon(body: string): void {
  if (!isNotificationSupported()) return;
  if (Notification.permission !== 'granted') return;

  showNotificationSafely('まもなく出番です', {
    body,
    icon: '/badminton-manager/icons/icon-192x192.png',
    tag: 'next-match-soon',
    vibrate: [200, 100, 200],
  });
}

/**
 * 未対応（会費・名簿・試合結果）による強制休憩を通知する。
 * body は呼び出し側で組み立てる。tagKey はプレイヤー名や matchId 等の
 * 重複置換キー（同じ tag の通知は上書きされる）。
 */
export function notifyForcedRest(tagKey: string, body: string): void {
  if (!isNotificationSupported()) return;
  if (Notification.permission !== 'granted') return;

  showNotificationSafely('未対応のため休憩', {
    body,
    icon: '/badminton-manager/icons/icon-192x192.png',
    tag: `forced-rest-${tagKey}`,
  });
}
