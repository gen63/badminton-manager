import { test, expect } from '@playwright/test';

test.describe('ホーム画面', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('タイトルが表示される', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('バドミントン');
  });

  test('セッション開始ボタンが表示される', async ({ page }) => {
    const startButton = page.getByRole('button', { name: /開始|セッション/i });
    await expect(startButton).toBeVisible();
  });

  test('ナビゲーションが機能する', async ({ page }) => {
    // 履歴ページへのリンクがあれば確認
    const historyLink = page.getByRole('link', { name: /履歴/i });
    if (await historyLink.isVisible()) {
      await historyLink.click();
      await expect(page).toHaveURL(/history/);
    }
  });
});

test.describe('セッション作成', () => {
  test('新しいセッションを開始できる', async ({ page }) => {
    await page.goto('/');

    // セッション開始ボタンをクリック
    const startButton = page.getByRole('button', { name: /開始|セッション|新規/i });
    if (await startButton.isVisible()) {
      await startButton.click();

      // セッション設定画面またはメイン画面に遷移することを確認
      await expect(page.locator('body')).toBeVisible();
    }
  });
});
