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
export function notifyMatchStart(courtNumber: number, startedAt?: number): void {
  if (!isNotificationSupported()) return;
  if (Notification.permission !== 'granted') return;

  // タイムラグを計算
  const now = Date.now();
  const lagMs = startedAt ? now - startedAt : 0;
  const lagSec = Math.round(lagMs / 100) / 10; // 小数点1桁

  const body = startedAt && lagSec > 0
    ? `コート${courtNumber}の試合が始まりました（${lagSec}秒前）`
    : `コート${courtNumber}の試合が始まりました`;

  new Notification('試合開始！', {
    body,
    icon: '/badminton-manager/icons/icon-192x192.png',
    tag: `match-start-court-${courtNumber}`,
  });
}
