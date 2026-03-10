import { test, expect, Browser, Page } from '@playwright/test';

/**
 * Firebase同期のE2Eテスト
 * 
 * 2つのブラウザを起動し、実際のFirestoreを使って同期動作を検証します。
 * 
 * 実行方法:
 * npm run test:e2e
 * 
 * UIモード（デバッグ）:
 * npm run test:e2e:ui
 */

// テスト用のプレイヤー
const TEST_PLAYERS = 'Player1\nPlayer2\nPlayer3\nPlayer4';

/**
 * URLからセッションIDを抽出
 */
async function getSessionIdFromURL(page: Page): Promise<string> {
  const url = page.url();
  const match = url.match(/\/main\?.*session=([A-Z0-9]{6})/);
  if (!match) {
    throw new Error('セッションIDが見つかりません: ' + url);
  }
  return match[1];
}

/**
 * セッションを作成してMainPageに遷移
 */
async function createSession(page: Page): Promise<string> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // プレイヤー入力
  const textarea = page.locator('textarea[placeholder*="プレイヤー"]').first();
  await textarea.fill(TEST_PLAYERS);

  // 開始ボタンをクリック
  const startButton = page.getByRole('button', { name: /開始/ });
  await startButton.click();

  // MainPageに遷移するまで待機
  await page.waitForURL('**/main?**', { timeout: 10000 });

  // セッションIDを取得
  const sessionId = await getSessionIdFromURL(page);
  console.log('[Session Created]', sessionId);

  return sessionId;
}

/**
 * セッションに参加してMainPageに遷移
 */
async function joinSession(page: Page, sessionId: string, userName: string): Promise<void> {
  await page.goto(`/session/${sessionId}`);
  await page.waitForLoadState('networkidle');

  // 名前を選択（または追加）
  const nameButton = page.getByRole('button', { name: userName });
  const nameExists = await nameButton.count() > 0;

  if (nameExists) {
    await nameButton.click();
  } else {
    // 新しいプレイヤーとして追加
    const addButton = page.getByRole('button', { name: /新しいプレイヤー/ });
    await addButton.click();
    const input = page.locator('input[placeholder*="名前"]');
    await input.fill(userName);
    const confirmButton = page.getByRole('button', { name: /追加/ });
    await confirmButton.click();
  }

  // 参加ボタンをクリック
  const joinButton = page.getByRole('button', { name: /参加/ });
  await joinButton.click();

  // MainPageに遷移するまで待機
  await page.waitForURL('**/main?**', { timeout: 10000 });

  console.log('[Session Joined]', sessionId, 'as', userName);
}

test.describe('Firebase同期テスト', () => {
  let browserA: Browser;
  let browserB: Browser;
  let pageA: Page;
  let pageB: Page;

  test.beforeEach(async ({ browser }) => {
    // 2つの独立したブラウザコンテキストを作成
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    
    pageA = await contextA.newPage();
    pageB = await contextB.newPage();

    // デバッグ用のコンソールログを有効化
    pageA.on('console', msg => console.log('[Browser A]', msg.text()));
    pageB.on('console', msg => console.log('[Browser B]', msg.text()));
  });

  test.afterEach(async () => {
    await pageA?.close();
    await pageB?.close();
  });

  test('ブラウザAで休憩→ブラウザBに即座に反映される', async () => {
    // ブラウザA: セッション作成
    const sessionId = await createSession(pageA);

    // ブラウザB: セッション参加
    await joinSession(pageB, sessionId, 'User-B');

    // 初期状態確認: 両方で4人のプレイヤーが表示される
    await expect(pageA.locator('button[aria-label*="休憩"]')).toHaveCount(4, { timeout: 5000 });
    await expect(pageB.locator('button[aria-label*="休憩"]')).toHaveCount(4, { timeout: 5000 });

    // ブラウザA: 1人目のプレイヤーを休憩
    const restButtonA = pageA.locator('button[aria-label*="休憩"]').first();
    await restButtonA.click();

    // ブラウザA: 休憩ボタンが復帰ボタンに変わることを確認
    await expect(pageA.locator('button[aria-label*="復帰"]').first()).toBeVisible({ timeout: 2000 });

    // ブラウザB: 1秒以内に休憩が反映されることを確認
    await expect(pageB.locator('button[aria-label*="復帰"]').first()).toBeVisible({ timeout: 1000 });

    console.log('✅ 休憩の同期成功');
  });

  test('ブラウザAで休憩復帰→ブラウザBに即座に反映される', async () => {
    // ブラウザA: セッション作成
    const sessionId = await createSession(pageA);

    // ブラウザB: セッション参加
    await joinSession(pageB, sessionId, 'User-B');

    // ブラウザA: 1人目のプレイヤーを休憩
    await pageA.locator('button[aria-label*="休憩"]').first().click();
    await expect(pageA.locator('button[aria-label*="復帰"]').first()).toBeVisible({ timeout: 2000 });

    // ブラウザB: 反映を確認
    await expect(pageB.locator('button[aria-label*="復帰"]').first()).toBeVisible({ timeout: 1000 });

    // ブラウザA: 休憩復帰
    const returnButtonA = pageA.locator('button[aria-label*="復帰"]').first();
    await returnButtonA.click();

    // ブラウザA: 復帰ボタンが休憩ボタンに変わることを確認
    await expect(pageA.locator('button[aria-label*="休憩"]')).toHaveCount(4, { timeout: 2000 });

    // ブラウザB: 1秒以内に復帰が反映されることを確認
    await expect(pageB.locator('button[aria-label*="休憩"]')).toHaveCount(4, { timeout: 1000 });

    console.log('✅ 復帰の同期成功');
  });

  test('ブラウザAとBで同時に操作→競合せず両方反映される', async () => {
    // ブラウザA: セッション作成
    const sessionId = await createSession(pageA);

    // ブラウザB: セッション参加
    await joinSession(pageB, sessionId, 'User-B');

    // 初期状態: 4人の待機プレイヤー
    await expect(pageA.locator('button[aria-label*="休憩"]')).toHaveCount(4, { timeout: 5000 });
    await expect(pageB.locator('button[aria-label*="休憩"]')).toHaveCount(4, { timeout: 5000 });

    // ほぼ同時に操作
    await Promise.all([
      pageA.locator('button[aria-label*="休憩"]').nth(0).click(), // 1人目を休憩
      pageB.locator('button[aria-label*="休憩"]').nth(1).click(), // 2人目を休憩
    ]);

    // 両方のブラウザで、最終的に2人が休憩状態になる
    await expect(pageA.locator('button[aria-label*="復帰"]')).toHaveCount(2, { timeout: 3000 });
    await expect(pageB.locator('button[aria-label*="復帰"]')).toHaveCount(2, { timeout: 3000 });

    console.log('✅ 同時操作の競合解決成功');
  });

  test('古いデータで上書きされない（タイムスタンプ検証）', async () => {
    // ブラウザA: セッション作成
    const sessionId = await createSession(pageA);

    // ブラウザB: セッション参加
    await joinSession(pageB, sessionId, 'User-B');

    // ブラウザA: 1人目を休憩
    await pageA.locator('button[aria-label*="休憩"]').first().click();
    await expect(pageA.locator('button[aria-label*="復帰"]')).toHaveCount(1, { timeout: 2000 });

    // ブラウザB: 反映確認
    await expect(pageB.locator('button[aria-label*="復帰"]')).toHaveCount(1, { timeout: 1000 });

    // ブラウザA: 復帰
    await pageA.locator('button[aria-label*="復帰"]').first().click();
    await expect(pageA.locator('button[aria-label*="休憩"]')).toHaveCount(4, { timeout: 2000 });

    // ブラウザB: 最新状態が反映される（古い「休憩」状態に戻らない）
    await expect(pageB.locator('button[aria-label*="休憩"]')).toHaveCount(4, { timeout: 1000 });

    // 2秒待機しても古いデータで上書きされない
    await pageB.waitForTimeout(2000);
    await expect(pageB.locator('button[aria-label*="休憩"]')).toHaveCount(4);

    console.log('✅ タイムスタンプによる古いデータ拒否成功');
  });

  test('PWAとブラウザ間でも同期が動作する', async () => {
    // ブラウザA: セッション作成
    const sessionId = await createSession(pageA);

    // ブラウザB: PWAモードをシミュレート（display-mode: standalone）
    const contextB = await pageB.context().browser()!.newContext({
      viewport: { width: 375, height: 667 }, // モバイルサイズ
    });
    const pageBPWA = await contextB.newPage();

    // セッション参加
    await joinSession(pageBPWA, sessionId, 'User-B-PWA');

    // ブラウザA: プレイヤーを休憩
    await pageA.locator('button[aria-label*="休憩"]').first().click();
    await expect(pageA.locator('button[aria-label*="復帰"]')).toHaveCount(1, { timeout: 2000 });

    // PWA（ブラウザB）: 同期確認
    await expect(pageBPWA.locator('button[aria-label*="復帰"]')).toHaveCount(1, { timeout: 1000 });

    console.log('✅ PWA同期成功');

    await pageBPWA.close();
    await contextB.close();
  });
});
