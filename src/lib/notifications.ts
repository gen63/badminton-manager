/** Browser Notification API ユーティリティ */

/** 通知が使える環境かどうか */
export function isNotificationSupported(): boolean {
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

/** 試合開始通知を送信 */
export function notifyMatchStart(courtNumber: number): void {
  if (!isNotificationSupported()) return;
  if (Notification.permission !== 'granted') return;

  new Notification('試合開始！', {
    body: `コート${courtNumber}の試合が始まりました`,
    icon: '/badminton-manager/icons/icon-192x192.png',
    tag: `match-start-court-${courtNumber}`,
  });
}
