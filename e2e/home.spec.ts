import { test, expect } from '@playwright/test';

test.describe('セッション作成画面', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('コート数選択ボタンが表示される', async ({ page }) => {
    await expect(page.getByRole('button', { name: '1', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '2', exact: true })).toBeVisible();
    // 3はデフォルト選択状態で「✓」が前置されるためexactなしで検索
    await expect(page.getByRole('button', { name: '3' })).toBeVisible();
  });

  test('目標点数選択ボタンが表示される', async ({ page }) => {
    await expect(page.getByRole('button', { name: '15' })).toBeVisible();
    await expect(page.getByRole('button', { name: '21' })).toBeVisible();
  });

  test('開始ボタンが表示される', async ({ page }) => {
    await expect(page.getByRole('button', { name: /開始/i })).toBeVisible();
  });

  test('開始ボタンでメイン画面に遷移できる', async ({ page }) => {
    // 開始ボタンをクリック
    await page.getByRole('button', { name: /開始/i }).click();

    // メイン画面に遷移したことを確認（コートカードが表示される）
    await expect(page.locator('.card')).toBeVisible({ timeout: 10000 });
  });
});
