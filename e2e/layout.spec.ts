import { test, expect } from '@playwright/test';

/**
 * テストプラン検証
 * - コート間の余白が適切な幅になっていることを確認
 * - 参加者一覧・休憩中メンバーが三列グリッドで表示されることを確認
 * - 未配置コートと配置済みコートの高さが揃っていることを確認
 * - 配置ボタン押下時にレイアウトジャンプが発生しないことを確認
 * - ゲーム開始ボタン押下時にレイアウトジャンプが発生しないことを確認
 * - スコア入力画面でメンバー選択時にレイアウトジャンプが発生しないこと
 */

test.describe('レイアウト検証', () => {
  // テスト用セッションを作成するヘルパー
  async function setupTestSession(page: import('@playwright/test').Page) {
    await page.goto('/');

    // セッション設定画面でセッション開始
    const startButton = page.getByRole('button', { name: /開始|セッション|新規/i });
    if (await startButton.isVisible()) {
      await startButton.click();
    }

    // セッション設定画面が表示された場合は設定して開始
    const sessionStartButton = page.getByRole('button', { name: /練習開始|開始/i });
    if (await sessionStartButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await sessionStartButton.click();
    }

    // メイン画面に遷移するまで待機
    await page.waitForSelector('.card', { timeout: 5000 });
  }

  test('コート間の余白が20pxであること', async ({ page }) => {
    await setupTestSession(page);

    // コートコンテナのgapを確認
    const courtContainer = page.locator('.flex.justify-center.items-stretch').first();
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

    // 3列のグリッド（repeat(3, minmax(0, 1fr))相当）であることを確認
    const columnCount = gridColumns.split(' ').length;
    expect(columnCount).toBe(3);
  });

  test('休憩中メンバーが三列グリッドで表示されること', async ({ page }) => {
    await setupTestSession(page);

    // 休憩中メンバーのグリッドを確認（2つ目のgrid-cols-3）
    const grids = page.locator('.grid.grid-cols-3');
    const count = await grids.count();

    // 少なくとも参加者一覧のグリッドがあること
    expect(count).toBeGreaterThanOrEqual(1);

    // 休憩中メンバーがいる場合は2つ目のグリッドも確認
    if (count >= 2) {
      const restingGrid = grids.nth(1);
      const gridColumns = await restingGrid.evaluate((el) => {
        return window.getComputedStyle(el).gridTemplateColumns;
      });
      const columnCount = gridColumns.split(' ').length;
      expect(columnCount).toBe(3);
    }
  });

  test('コートカードのプレイヤーエリアがminHeight 188pxを持つこと', async ({ page }) => {
    await setupTestSession(page);

    // 各コートカード内のプレイヤー表示エリアを確認
    const courtCards = page.locator('.card');
    const firstCourtCard = courtCards.first();

    // プレイヤー表示エリア（minHeight: 188pxを持つdiv）を取得
    const playerArea = firstCourtCard.locator('div[style*="min-height"]');
    const minHeight = await playerArea.evaluate((el) => {
      return window.getComputedStyle(el).minHeight;
    });

    expect(minHeight).toBe('188px');
  });

  test('未配置コートと配置済みコートの高さが揃っていること', async ({ page }) => {
    await setupTestSession(page);

    // コートカードを取得
    const courtCards = page.locator('.card');
    const count = await courtCards.count();

    if (count >= 2) {
      // 全コートの高さを取得
      const heights: number[] = [];
      for (let i = 0; i < count; i++) {
        const card = courtCards.nth(i);
        const box = await card.boundingBox();
        if (box) {
          heights.push(box.height);
        }
      }

      // 高さが揃っていることを確認（±5pxの許容誤差）
      const maxHeight = Math.max(...heights);
      const minHeight = Math.min(...heights);
      expect(maxHeight - minHeight).toBeLessThanOrEqual(5);
    }
  });
});

test.describe('レイアウトジャンプ検証', () => {
  async function setupTestSession(page: import('@playwright/test').Page) {
    await page.goto('/');

    const startButton = page.getByRole('button', { name: /開始|セッション|新規/i });
    if (await startButton.isVisible()) {
      await startButton.click();
    }

    const sessionStartButton = page.getByRole('button', { name: /練習開始|開始/i });
    if (await sessionStartButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await sessionStartButton.click();
    }

    await page.waitForSelector('.card', { timeout: 5000 });
  }

  test('配置ボタン押下時にレイアウトジャンプが発生しないこと', async ({ page }) => {
    await setupTestSession(page);

    // 配置ボタンを探す
    const assignButton = page.getByRole('button', { name: /配置/i }).first();

    if (await assignButton.isVisible()) {
      // 配置ボタンの位置を記録
      const buttonBefore = await assignButton.boundingBox();

      // 参加者一覧の位置を記録
      const playerSection = page.locator('text=参加者一覧').first();
      const sectionBefore = await playerSection.boundingBox();

      // 配置ボタンをクリック
      await assignButton.click();

      // 少し待機
      await page.waitForTimeout(100);

      // 参加者一覧の位置を再取得
      const sectionAfter = await playerSection.boundingBox();

      // Y座標の変化が最小限であることを確認（±5pxの許容誤差）
      if (sectionBefore && sectionAfter) {
        const yDiff = Math.abs(sectionBefore.y - sectionAfter.y);
        expect(yDiff).toBeLessThanOrEqual(5);
      }
    }
  });

  test('ゲーム開始ボタン押下時にレイアウトジャンプが発生しないこと', async ({ page }) => {
    await setupTestSession(page);

    // まず配置を行う
    const assignButton = page.getByRole('button', { name: /配置/i }).first();
    if (await assignButton.isVisible()) {
      await assignButton.click();
      await page.waitForTimeout(100);
    }

    // 開始ボタンを探す
    const startButton = page.getByRole('button', { name: /^開始$/i }).first();

    if (await startButton.isVisible()) {
      // コートカードの位置を記録
      const courtCard = page.locator('.card').first();
      const cardBefore = await courtCard.boundingBox();

      // 参加者一覧の位置を記録
      const playerSection = page.locator('text=参加者一覧').first();
      const sectionBefore = await playerSection.boundingBox();

      // 開始ボタンをクリック
      await startButton.click();

      // 少し待機
      await page.waitForTimeout(100);

      // コートカードの位置を再取得
      const cardAfter = await courtCard.boundingBox();

      // 参加者一覧の位置を再取得
      const sectionAfter = await playerSection.boundingBox();

      // コートカードのサイズ変化が最小限であることを確認
      if (cardBefore && cardAfter) {
        const widthDiff = Math.abs(cardBefore.width - cardAfter.width);
        const heightDiff = Math.abs(cardBefore.height - cardAfter.height);
        expect(widthDiff).toBeLessThanOrEqual(5);
        expect(heightDiff).toBeLessThanOrEqual(5);
      }

      // Y座標の変化が最小限であることを確認
      if (sectionBefore && sectionAfter) {
        const yDiff = Math.abs(sectionBefore.y - sectionAfter.y);
        expect(yDiff).toBeLessThanOrEqual(5);
      }
    }
  });

  test('cardクラスに透明ボーダーがあること（開始時ジャンプ防止）', async ({ page }) => {
    await setupTestSession(page);

    // .cardクラスのボーダーを確認
    const card = page.locator('.card').first();
    const border = await card.evaluate((el) => {
      return window.getComputedStyle(el).border;
    });

    // ボーダーが存在すること（transparent含む）
    expect(border).toContain('2px');
  });
});

test.describe('スコア入力画面のレイアウトジャンプ検証', () => {
  test('メンバー選択時にメッセージがinvisibleで表示されレイアウトジャンプが発生しないこと', async ({ page }) => {
    // この検証はスコア入力画面へのアクセスが必要
    // 実際のテストではセッションを作成し、試合を終了してスコア入力画面に遷移する必要がある

    await page.goto('/');

    // セッション開始
    const startButton = page.getByRole('button', { name: /開始|セッション|新規/i });
    if (await startButton.isVisible()) {
      await startButton.click();
    }

    const sessionStartButton = page.getByRole('button', { name: /練習開始|開始/i });
    if (await sessionStartButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await sessionStartButton.click();
    }

    await page.waitForSelector('.card', { timeout: 5000 });

    // 配置→開始→終了の流れでスコア入力画面に到達
    const assignButton = page.getByRole('button', { name: /配置/i }).first();
    if (await assignButton.isVisible()) {
      await assignButton.click();
      await page.waitForTimeout(200);
    }

    const gameStartButton = page.getByRole('button', { name: /^開始$/i }).first();
    if (await gameStartButton.isVisible()) {
      await gameStartButton.click();
      await page.waitForTimeout(200);
    }

    const finishButton = page.getByRole('button', { name: /終了/i }).first();
    if (await finishButton.isVisible()) {
      await finishButton.click();
      await page.waitForTimeout(200);
    }

    // スコア入力ボタンを探してクリック
    const scoreInputButton = page.getByRole('button', { name: /入力/i }).first();
    if (await scoreInputButton.isVisible()) {
      await scoreInputButton.click();
      await page.waitForTimeout(200);

      // スコア入力画面でメンバー選択メッセージを確認
      const selectionMessage = page.locator('text=メンバーを選択中');

      // 初期状態では invisible クラスが付いていること
      const messageContainer = page.locator('.bg-indigo-50.border-indigo-200');
      const isInvisible = await messageContainer.evaluate((el) => {
        return el.classList.contains('invisible');
      });
      expect(isInvisible).toBe(true);

      // プレイヤーボタンをクリック
      const playerButtons = page.locator('.bg-gray-50 button');
      const firstPlayer = playerButtons.first();

      if (await firstPlayer.isVisible()) {
        // クリック前の位置を記録
        const containerBefore = await messageContainer.boundingBox();

        // プレイヤーをクリック
        await firstPlayer.click();
        await page.waitForTimeout(100);

        // メッセージが表示されること
        const isStillInvisible = await messageContainer.evaluate((el) => {
          return el.classList.contains('invisible');
        });
        expect(isStillInvisible).toBe(false);

        // クリック後の位置を確認（変化がないこと）
        const containerAfter = await messageContainer.boundingBox();

        if (containerBefore && containerAfter) {
          // 位置が変わっていないことを確認
          expect(Math.abs(containerBefore.y - containerAfter.y)).toBeLessThanOrEqual(2);
          expect(Math.abs(containerBefore.height - containerAfter.height)).toBeLessThanOrEqual(2);
        }
      }
    }
  });
});
