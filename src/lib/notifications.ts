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
export function notifyMatchStart(
  courtNumber: number,
  matchNumber: number,
  teamANames: string[],
  teamBNames: string[],
  startedAt?: number
): void {
  if (!isNotificationSupported()) return;
  if (Notification.permission !== 'granted') return;

  // タイムラグを計算
  const now = Date.now();
  const lagMs = startedAt ? now - startedAt : 0;
  const lagSec = Math.round(lagMs / 100) / 10; // 小数点1桁

  // チーム名を整形（空文字を除外して結合）
  const teamA = teamANames.filter(n => n).join(' ');
  const teamB = teamBNames.filter(n => n).join(' ');
  const matchInfo = teamA && teamB ? `${teamA} vs ${teamB}` : '';

  const lagInfo = startedAt && lagSec > 0 ? `（${lagSec}秒前）` : '';
  
  const body = matchInfo
    ? `#${matchNumber} コート${courtNumber}: ${matchInfo} ${lagInfo}`.trim()
    : `#${matchNumber} コート${courtNumber}が始まりました ${lagInfo}`.trim();

  new Notification('試合開始！', {
    body,
    icon: '/badminton-manager/icons/icon-192x192.png',
    tag: `match-start-court-${courtNumber}`,
  });
}
