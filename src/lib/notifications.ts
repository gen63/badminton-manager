/** Browser Notification API ユーティリティ */

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
 * 次の試合に入りそうなメンバーへの事前呼び出し通知を送信。
 * body の組み立ては呼び出し側（buildNextMatchCallMessage）の責務。
 */
export function notifyNextMatchSoon(body: string): void {
  if (!isNotificationSupported()) return;
  if (Notification.permission !== 'granted') return;

  new Notification('まもなく出番です', {
    body,
    icon: '/badminton-manager/icons/icon-192x192.png',
    tag: 'next-match-soon',
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

  new Notification('未対応のため休憩', {
    body,
    icon: '/badminton-manager/icons/icon-192x192.png',
    tag: `forced-rest-${tagKey}`,
  });
}
