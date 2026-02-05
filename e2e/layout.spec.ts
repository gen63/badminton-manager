import { test, expect, Page } from '@playwright/test';

// テスト用のプレイヤー名（16人 = 3コート分+待機4人）
const TEST_PLAYERS = [
  '田中太郎', '山田花子', '佐藤次郎', '鈴木一郎',
  '高橋三郎', '伊藤四郎', '渡辺五郎', '中村六郎',
  '小林七郎', '加藤八郎', '吉田九郎', '山本十郎',
  '松本十一', '井上十二', '木村十三', '林十四'
].join('\n');

// セッションを作成してメイン画面に遷移するヘルパー
async function setupTestSession(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const textarea = page.locator('textarea');
  await textarea.fill(TEST_PLAYERS);

  await page.getByRole('button', { name: /開始/i }).click();
  await page.waitForURL('**/main', { timeout: 10000 });

  // コートカードが表示されるまで待機
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 10000 });
}

// 全プレイヤーを休憩→待機に復帰させるヘルパー
async function activateAllPlayers(page: Page) {
  await expect(page.locator('button[aria-label="復帰"]').first()).toBeVisible({ timeout: 10000 });

  // 復帰ボタンがなくなるまでクリック
  while (await page.locator('button[aria-label="復帰"]').count() > 0) {
    await page.locator('button[aria-label="復帰"]').first().click();
    // 次の復帰ボタンの出現 or 全復帰完了を待つ
    await expect(page.locator('button[aria-label="休憩"]').first()).toBeVisible({ timeout: 5000 });
  }
}

test.describe('ゲーム操作フロー', () => {
  test('一括配置→ゲーム開始→ゲーム終了の一連の操作ができる', async ({ page }) => {
    await setupTestSession(page);
    await activateAllPlayers(page);

    // 一括配置
    const assignButton = page.getByRole('button', { name: /一括配置/i });
    await expect(assignButton).toBeEnabled({ timeout: 5000 });
    await assignButton.click();

    // 配置後、開始ボタンが表示される
    const startButton = page.locator('.card').first().getByRole('button', { name: /開始/ });
    await expect(startButton).toBeVisible({ timeout: 5000 });

    // ゲーム開始
    await startButton.click();

    // 終了ボタンが表示される
    const finishButton = page.locator('.card').first().getByRole('button', { name: /終了/ });
    await expect(finishButton).toBeVisible({ timeout: 5000 });

    // ゲーム終了
    await finishButton.click();

    // 終了後、スコア未入力セクションに試合が追加される
    const unfinishedSection = page.locator('[data-testid="unfinished-matches"]');
    await expect(unfinishedSection).toBeVisible();
    await expect(unfinishedSection.getByRole('button', { name: /入力/i })).toBeVisible({ timeout: 5000 });
  });

  test('ゲーム終了後にスコア入力画面へ遷移できる', async ({ page }) => {
    await setupTestSession(page);
    await activateAllPlayers(page);

    // 配置→開始→終了
    await page.getByRole('button', { name: /一括配置/i }).click();
    const startButton = page.locator('.card').first().getByRole('button', { name: /開始/ });
    await expect(startButton).toBeVisible({ timeout: 5000 });
    await startButton.click();

    const finishButton = page.locator('.card').first().getByRole('button', { name: /終了/ });
    await expect(finishButton).toBeVisible({ timeout: 5000 });
    await finishButton.click();

    // スコア入力ボタンをクリック
    const scoreInputButton = page.locator('[data-testid="unfinished-matches"]').getByRole('button', { name: /入力/i }).first();
    await expect(scoreInputButton).toBeVisible({ timeout: 5000 });
    await scoreInputButton.click();

    // スコア入力画面に遷移したことを確認
    await page.waitForURL('**/score/**', { timeout: 5000 });
  });
});

test.describe('プレイヤー管理', () => {
  test('プレイヤーの休憩・復帰を切り替えられる', async ({ page }) => {
    await setupTestSession(page);

    // 初期状態: 全員休憩中（復帰ボタンが表示される）
    const returnButton = page.locator('button[aria-label="復帰"]').first();
    await expect(returnButton).toBeVisible({ timeout: 10000 });

    // 復帰させる
    await returnButton.click();

    // 休憩ボタンが表示される（アクティブ状態になった）
    await expect(page.locator('button[aria-label="休憩"]').first()).toBeVisible({ timeout: 5000 });

    // 休憩させる
    await page.locator('button[aria-label="休憩"]').first().click();

    // 復帰ボタンが再び表示される
    await expect(page.locator('button[aria-label="復帰"]').first()).toBeVisible({ timeout: 5000 });
  });

  test('アクティブプレイヤーに試合参加数が表示される', async ({ page }) => {
    await setupTestSession(page);

    // 数名を復帰させる
    await expect(page.locator('button[aria-label="復帰"]').first()).toBeVisible({ timeout: 10000 });
    for (let i = 0; i < 3; i++) {
      const btn = page.locator('button[aria-label="復帰"]').first();
      if (await btn.isVisible()) {
        await btn.click();
        await expect(page.locator('button[aria-label="休憩"]').first()).toBeVisible({ timeout: 5000 });
      }
    }

    // アクティブプレイヤーのピルに (数字) 形式の試合数が表示されている
    const activePills = page.locator('.player-pill').filter({ has: page.locator('button[aria-label="休憩"]') });
    const count = await activePills.count();
    expect(count).toBeGreaterThan(0);

    const countSpan = activePills.first().locator('span.flex-shrink-0');
    await expect(countSpan).toBeVisible();
    await expect(countSpan).toHaveText(/\(\d+\)/);
  });

  test('スコア未入力の試合がないときにメッセージが表示される', async ({ page }) => {
    await setupTestSession(page);

    const section = page.locator('[data-testid="unfinished-matches"]');
    await expect(section).toBeVisible();
    await expect(section.getByText('スコア未入力の試合がありません')).toBeVisible();
  });
});

test.describe('コート表示', () => {
  test('3コート分のカードが表示される', async ({ page }) => {
    await setupTestSession(page);

    const cards = page.locator('.card');
    // コートカード3枚 + スコア未入力セクション1枚 = 4枚以上
    await expect(cards).toHaveCount(4, { timeout: 5000 });
  });

  test('未配置コートに配置ボタンが表示される', async ({ page }) => {
    await setupTestSession(page);
    await activateAllPlayers(page);

    // 個別コートの配置ボタンが表示される
    const firstCard = page.locator('.card').first();
    await expect(firstCard.getByRole('button', { name: /配置/ })).toBeVisible({ timeout: 5000 });
  });
});
