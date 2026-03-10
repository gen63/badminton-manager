/** PWA Badge API ユーティリティ */

/** Badging APIが使える環境かどうか */
export function isBadgeSupported(): boolean {
  return 'setAppBadge' in navigator && 'clearAppBadge' in navigator;
}

/** アプリバッジに数値を設定 */
export async function setAppBadge(count: number): Promise<void> {
  if (!isBadgeSupported()) return;
  
  try {
    await (navigator as Navigator & { setAppBadge: (count: number) => Promise<void> }).setAppBadge(count);
    console.log('[Badge] Set badge:', count);
  } catch (error) {
    console.error('[Badge] Failed to set badge:', error);
  }
}

/** アプリバッジをクリア */
export async function clearAppBadge(): Promise<void> {
  if (!isBadgeSupported()) return;
  
  try {
    await (navigator as Navigator & { clearAppBadge: () => Promise<void> }).clearAppBadge();
    console.log('[Badge] Cleared badge');
  } catch (error) {
    console.error('[Badge] Failed to clear badge:', error);
  }
}

/**
 * 支払い予定額をバッジに表示
 * @param isPaid 支払い済みかどうか
 * @param amount 支払い予定額（円）
 */
export async function updatePaymentBadge(isPaid: boolean, amount?: number): Promise<void> {
  if (isPaid) {
    // 支払い済み → バッジをクリア
    await clearAppBadge();
  } else if (amount !== undefined && amount > 0) {
    // 未払い → 金額を表示
    await setAppBadge(amount);
  } else {
    // 金額不明 → バッジをクリア
    await clearAppBadge();
  }
}
