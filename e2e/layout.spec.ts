import { test, expect, Page } from '@playwright/test';

/**
 * テストプラン検証
 * - コート間の余白が適切な幅になっていることを確認
 * - 参加者一覧・休憩中メンバーが三列グリッドで表示されることを確認
 * - 未配置コートと配置済みコートの高さが揃っていることを確認
 * - 配置ボタン押下時にレイアウトジャンプが発生しないことを確認
 * - ゲーム開始ボタン押下時にレイアウトジャンプが発生しないことを確認
 * - スコア入力画面でメンバー選択時にレイアウトジャンプが発生しないこと
 */

// テスト用のプレイヤー名（12人 = 3コート分）
const TEST_PLAYERS = [
  '田中太郎', '山田花子', '佐藤次郎', '鈴木一郎',
  '高橋三郎', '伊藤四郎', '渡辺五郎', '中村六郎',
  '小林七郎', '加藤八郎', '吉田九郎', '山本十郎'
].join('\n');

// セッションを作成してメイン画面に遷移するヘルパー
async function setupTestSession(page: Page, addPlayers = true) {
  await page.goto('/');

  // ページが読み込まれるまで待機
  await page.waitForLoadState('networkidle');

  if (addPlayers) {
    // 練習参加メンバーのテキストエリアに入力
    const textarea = page.locator('textarea');
    await textarea.fill(TEST_PLAYERS);
  }

  // 開始ボタンをクリック
  await page.getByRole('button', { name: /開始/i }).click();

  // メイン画面に遷移するまで待機
  await page.waitForURL('**/main', { timeout: 10000 });
  await page.waitForLoadState('networkidle');

  // コートカードが表示されるまで待機
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 10000 });
}

test.describe('レイアウト検証', () => {
  test('コート間の余白が20pxであること', async ({ page }) => {
    await setupTestSession(page);

    // コートコンテナのgapを確認
    const courtContainer = page.locator('.flex.justify-center.items-stretch').first();
    await expect(courtContainer).toBeVisible();

    const gap = await courtContainer.evaluate((el) => {
      return window.getComputedStyle(el).gap;
    });

    expect(gap).toBe('20px');
  });

  test('参加者一覧が三列グリッドで表示されること', async ({ page }) => {
    await setupTestSession(page);

    // 参加者グリッドを確認
    const playerGrid = page.locator('.grid.grid-cols-3').first();
    await expect(playerGrid).toBeVisible();

    // grid-template-columnsが3列であることを確認
    const gridColumns = await playerGrid.evaluate((el) => {
      return window.getComputedStyle(el).gridTemplateColumns;
    });

    // 3列のグリッドであることを確認
    const columnCount = gridColumns.split(' ').length;
    expect(columnCount).toBe(3);
  });

  test('コートカードのプレイヤーエリアがminHeight 188pxを持つこと', async ({ page }) => {
    await setupTestSession(page);

    // 各コートカード内のプレイヤー表示エリアを確認
    const courtCards = page.locator('.card');
    const firstCourtCard = courtCards.first();
    await expect(firstCourtCard).toBeVisible();

    // プレイヤー表示エリア（minHeight: 188pxを持つdiv）を取得
    const playerArea = firstCourtCard.locator('div[style*="min-height"]');

    if (await playerArea.count() > 0) {
      const minHeight = await playerArea.evaluate((el) => {
        return window.getComputedStyle(el).minHeight;
      });
      expect(minHeight).toBe('188px');
    }
  });

  test('未配置コートと配置済みコートの高さが揃っていること', async ({ page }) => {
    await setupTestSession(page);

    // コートカードを取得
    const courtCards = page.locator('.card');
    const count = await courtCards.count();

    if (count >= 2) {
      // 全コートの高さを取得
      const heights: number[] = [];
      for (let i = 0; i < Math.min(count, 3); i++) {
        const card = courtCards.nth(i);
        const box = await card.boundingBox();
        if (box) {
          heights.push(box.height);
        }
      }

      if (heights.length >= 2) {
        // 高さが揃っていることを確認（±5pxの許容誤差）
        const maxHeight = Math.max(...heights);
        const minHeight = Math.min(...heights);
        expect(maxHeight - minHeight).toBeLessThanOrEqual(5);
      }
    }
  });
});

test.describe('レイアウトジャンプ検証', () => {
  test('配置ボタン押下時にレイアウトジャンプが発生しないこと', async ({ page }) => {
    await setupTestSession(page);

    // 一括配置ボタンを探す
    const assignButton = page.getByRole('button', { name: /一括配置/i });

    // ボタンが有効になっているか確認
    const isEnabled = await assignButton.isEnabled();

    if (isEnabled) {
      // 参加者一覧の位置を記録
      const playerSection = page.locator('text=参加者一覧').first();
      const sectionBefore = await playerSection.boundingBox();

      // 配置ボタンをクリック
      await assignButton.click();

      // 少し待機
      await page.waitForTimeout(300);

      // 参加者一覧の位置を再取得
      const sectionAfter = await playerSection.boundingBox();

      // Y座標の変化が最小限であることを確認（±10pxの許容誤差）
      if (sectionBefore && sectionAfter) {
        const yDiff = Math.abs(sectionBefore.y - sectionAfter.y);
        expect(yDiff).toBeLessThanOrEqual(10);
      }
    }
  });

  test('ゲーム開始ボタン押下時にレイアウトジャンプが発生しないこと', async ({ page }) => {
    await setupTestSession(page);

    // まず一括配置を行う
    const assignButton = page.getByRole('button', { name: /一括配置/i });
    if (await assignButton.isEnabled()) {
      await assignButton.click();
      await page.waitForTimeout(300);
    }

    // 開始ボタンを探す（コートカード内の開始ボタン）
    const startButton = page.locator('.card').first().getByRole('button', { name: /^開始$/i });

    if (await startButton.isVisible()) {
      // コートカードの位置を記録
      const courtCard = page.locator('.card').first();
      const cardBefore = await courtCard.boundingBox();

      // 開始ボタンをクリック
      await startButton.click();

      // 少し待機
      await page.waitForTimeout(300);

      // コートカードの位置を再取得
      const cardAfter = await courtCard.boundingBox();

      // コートカードのサイズ変化が最小限であることを確認
      if (cardBefore && cardAfter) {
        const widthDiff = Math.abs(cardBefore.width - cardAfter.width);
        const heightDiff = Math.abs(cardBefore.height - cardAfter.height);
        expect(widthDiff).toBeLessThanOrEqual(5);
        expect(heightDiff).toBeLessThanOrEqual(5);
      }
    }
  });

  test('cardクラスに透明ボーダーがあること（開始時ジャンプ防止）', async ({ page }) => {
    await setupTestSession(page);

    // .cardクラスのボーダーを確認
    const card = page.locator('.card').first();
    await expect(card).toBeVisible();

    const border = await card.evaluate((el) => {
      return window.getComputedStyle(el).border;
    });

    // ボーダーが存在すること（2px）
    expect(border).toContain('2px');
  });
});

test.describe('スコア入力画面のレイアウトジャンプ検証', () => {
  test('メンバー選択時にメッセージがinvisibleで表示されレイアウトジャンプが発生しないこと', async ({ page }) => {
    await setupTestSession(page);

    // 一括配置
    const assignButton = page.getByRole('button', { name: /一括配置/i });
    if (await assignButton.isEnabled()) {
      await assignButton.click();
      await page.waitForTimeout(300);
    }

    // ゲーム開始
    const gameStartButton = page.locator('.card').first().getByRole('button', { name: /^開始$/i });
    if (await gameStartButton.isVisible()) {
      await gameStartButton.click();
      await page.waitForTimeout(300);
    }

    // ゲーム終了
    const finishButton = page.locator('.card').first().getByRole('button', { name: /終了/i });
    if (await finishButton.isVisible()) {
      await finishButton.click();
      await page.waitForTimeout(300);
    }

    // スコア入力ボタンをクリック
    const scoreInputButton = page.getByRole('button', { name: /入力/i }).first();
    if (await scoreInputButton.isVisible()) {
      await scoreInputButton.click();
      await page.waitForTimeout(500);

      // スコア入力画面でメンバー選択メッセージを確認
      const messageContainer = page.locator('.bg-indigo-50.border-indigo-200');

      if (await messageContainer.isVisible()) {
        // 初期状態では invisible クラスが付いていること
        const hasInvisible = await messageContainer.evaluate((el) => {
          return el.classList.contains('invisible');
        });
        expect(hasInvisible).toBe(true);

        // プレイヤーボタンをクリック
        const playerButtons = page.locator('.bg-gray-50 button');
        const firstPlayer = playerButtons.first();

        if (await firstPlayer.isVisible()) {
          // クリック前の位置を記録
          const containerBefore = await messageContainer.boundingBox();

          // プレイヤーをクリック
          await firstPlayer.click();
          await page.waitForTimeout(100);

          // メッセージが表示されること（invisibleが外れる）
          const isStillInvisible = await messageContainer.evaluate((el) => {
            return el.classList.contains('invisible');
          });
          expect(isStillInvisible).toBe(false);

          // クリック後の位置を確認（変化がないこと）
          const containerAfter = await messageContainer.boundingBox();

          if (containerBefore && containerAfter) {
            expect(Math.abs(containerBefore.y - containerAfter.y)).toBeLessThanOrEqual(2);
          }
        }
      }
    }
  });
});
