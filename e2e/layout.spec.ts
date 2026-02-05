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

// テスト用のプレイヤー名（16人 = 3コート分+待機4人）
const TEST_PLAYERS = [
  '田中太郎', '山田花子', '佐藤次郎', '鈴木一郎',
  '高橋三郎', '伊藤四郎', '渡辺五郎', '中村六郎',
  '小林七郎', '加藤八郎', '吉田九郎', '山本十郎',
  '松本十一', '井上十二', '木村十三', '林十四'
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

// 全プレイヤーを休憩→待機に復帰させるヘルパー
// （全プレイヤーはisResting:trueで開始するため、一括配置等の操作前に必要）
async function activateAllPlayers(page: Page) {
  await expect(page.locator('.player-pill').first()).toBeVisible({ timeout: 10000 });
  const count = await page.locator('button[aria-label="復帰"]').count();
  for (let i = 0; i < count; i++) {
    await page.locator('button[aria-label="復帰"]').first().click();
    await page.waitForTimeout(50);
  }
  // アクティブプレイヤーが表示されるまで待機
  await expect(page.locator('button[aria-label="休憩"]').first()).toBeVisible({ timeout: 5000 });
}

test.describe('レイアウト検証', () => {
  test('コート間の余白が20pxであること', async ({ page }) => {
    await setupTestSession(page);

    // コートコンテナのgapを確認
    const courtContainer = page.locator('.flex.justify-center.items-stretch').first();
    await expect(courtContainer).toBeVisible();

    // columnGap（longhand）で確認（shorthand gapはブラウザにより空文字を返す場合がある）
    const columnGap = await courtContainer.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style.columnGap || style.gap;
    });

    expect(columnGap).toBe('20px');
  });

  test('参加者一覧が三列グリッドで表示されること', async ({ page }) => {
    await setupTestSession(page);

    // 全プレイヤーは休憩中で開始するため、player-pillが表示されるまで待機
    await expect(page.locator('.player-pill').first()).toBeVisible({ timeout: 10000 });

    // player-pillを含む参加者グリッドを確認（空のactive gridではなく休憩中グリッド）
    const playerGrid = page.locator('.grid.grid-cols-3').filter({ has: page.locator('.player-pill') }).first();
    await expect(playerGrid).toBeVisible();

    // grid-template-columnsが3列であることを確認
    const gridColumns = await playerGrid.evaluate((el) => {
      return window.getComputedStyle(el).gridTemplateColumns;
    });

    // 3列のグリッドであることを確認（"200px 200px 200px" のような形式）
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

    // コートカードを取得（最初の3つがコートカード）
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
  test('配置ボタン押下時にコートカードがレイアウトジャンプしないこと', async ({ page }) => {
    await setupTestSession(page);
    await activateAllPlayers(page);

    // 一括配置ボタンを探す
    const assignButton = page.getByRole('button', { name: /一括配置/i });
    await expect(assignButton).toBeEnabled({ timeout: 5000 });

    // activateAllPlayersでスクロールが発生するためページ最上部に戻す
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);

    // コートカード（ページ上部）の位置を記録
    const courtCard = page.locator('.card').first();
    const cardBefore = await courtCard.boundingBox();

    // 配置ボタンをクリック
    await assignButton.click();

    // 少し待機
    await page.waitForTimeout(500);

    // ページ最上部にスクロール（viewport基準の座標を安定させる）
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);

    // コートカードの位置を再取得
    const cardAfter = await courtCard.boundingBox();

    // コートカードの位置変化が最小限であることを確認（±5pxの許容誤差）
    if (cardBefore && cardAfter) {
      const yDiff = Math.abs(cardBefore.y - cardAfter.y);
      expect(yDiff).toBeLessThanOrEqual(5);
    }
  });

  test('ゲーム開始ボタン押下時にレイアウトジャンプが発生しないこと', async ({ page }) => {
    await setupTestSession(page);
    await activateAllPlayers(page);

    // まず一括配置を行う
    const assignButton = page.getByRole('button', { name: /一括配置/i });
    await expect(assignButton).toBeEnabled({ timeout: 5000 });
    await assignButton.click();
    await page.waitForTimeout(500);

    // 開始ボタンを探す（コートカード内の開始ボタン）
    const startButton = page.locator('.card').first().getByRole('button', { name: /開始/ });
    await expect(startButton).toBeVisible({ timeout: 5000 });

    // コートカードの位置を記録
    const courtCard = page.locator('.card').first();
    const cardBefore = await courtCard.boundingBox();

    // 開始ボタンをクリック
    await startButton.click();

    // 少し待機
    await page.waitForTimeout(500);

    // コートカードの位置を再取得
    const cardAfter = await courtCard.boundingBox();

    // コートカードのサイズ変化が最小限であることを確認
    if (cardBefore && cardAfter) {
      const widthDiff = Math.abs(cardBefore.width - cardAfter.width);
      const heightDiff = Math.abs(cardBefore.height - cardAfter.height);
      expect(widthDiff).toBeLessThanOrEqual(5);
      expect(heightDiff).toBeLessThanOrEqual(5);
    }
  });

  test('cardクラスに透明ボーダーがあること（開始時ジャンプ防止）', async ({ page }) => {
    await setupTestSession(page);

    // .cardクラスのボーダーを確認
    const card = page.locator('.card').first();
    await expect(card).toBeVisible();

    // CSS読み込み遅延に対応するためリトライ付きで確認
    await expect(async () => {
      const borderTopWidth = await card.evaluate((el) => {
        return window.getComputedStyle(el).borderTopWidth;
      });
      expect(borderTopWidth).toBe('2px');
    }).toPass({ timeout: 5000 });
  });
});

test.describe('参加者一覧の表示検証', () => {
  test('プレイヤーピルのアクションボタンが36px以下であること', async ({ page }) => {
    await setupTestSession(page);

    // 全プレイヤーは休憩中で開始するため、復帰ボタンを確認（休憩ボタンと同サイズ: min-w-[32px] min-h-[32px]）
    const actionButton = page.locator('button[aria-label="復帰"]').first();
    await expect(actionButton).toBeVisible({ timeout: 10000 });

    const box = await actionButton.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(36);
    expect(box!.height).toBeLessThanOrEqual(36);
  });

  test('試合参加数が常に表示されること', async ({ page }) => {
    await setupTestSession(page);

    // 全プレイヤーは休憩中で開始 → 数名を復帰させてアクティブプレイヤーpillを作る
    await expect(page.locator('button[aria-label="復帰"]').first()).toBeVisible({ timeout: 10000 });
    for (let i = 0; i < 3; i++) {
      const comebackBtn = page.locator('button[aria-label="復帰"]').first();
      if (await comebackBtn.isVisible()) {
        await comebackBtn.click();
        await page.waitForTimeout(100);
      }
    }

    // 復帰済みのアクティブプレイヤーpillを取得（休憩ボタンを持つもの = アクティブ状態）
    await expect(page.locator('button[aria-label="休憩"]').first()).toBeVisible({ timeout: 5000 });
    const activePills = page.locator('.player-pill').filter({ has: page.locator('button[aria-label="休憩"]') });
    const count = await activePills.count();
    expect(count).toBeGreaterThan(0);

    // 各プレイヤーの試合数が表示されていることを確認
    for (let i = 0; i < Math.min(count, 3); i++) {
      const pill = activePills.nth(i);
      // flex-shrink-0のカウントspan要素が見えていること（buttonも同クラスを持つためspan指定）
      const countSpan = pill.locator('span.flex-shrink-0');
      await expect(countSpan).toBeVisible();

      const text = await countSpan.textContent();
      // (数字) 形式であること
      expect(text).toMatch(/\(\d+\)/);
    }
  });

  test('スコア未入力の試合がない時にメッセージが表示されること', async ({ page }) => {
    await setupTestSession(page);

    // スコア未入力セクションが常に表示されること
    const section = page.locator('[data-testid="unfinished-matches"]');
    await expect(section).toBeVisible();

    // 「ありません」メッセージが表示されていること
    await expect(section.locator('text=スコア未入力の試合がありません')).toBeVisible();
  });

  test('スコア未入力セクションが試合終了前後でレイアウトジャンプしないこと', async ({ page }) => {
    await setupTestSession(page);
    await activateAllPlayers(page);

    // 一括配置→開始で試合中状態にする
    const assignButton = page.getByRole('button', { name: /一括配置/i });
    await expect(assignButton).toBeEnabled({ timeout: 5000 });
    await assignButton.click();
    await page.waitForTimeout(500);

    const gameStartButton = page.locator('.card').first().getByRole('button', { name: /開始/ });
    await expect(gameStartButton).toBeVisible({ timeout: 5000 });
    await gameStartButton.click();
    await page.waitForTimeout(500);

    // 試合終了の直前にセクション位置を記録（配置による自然なレイアウト変化の後）
    const section = page.locator('[data-testid="unfinished-matches"]');
    await expect(section).toBeVisible();
    const sectionBefore = await section.boundingBox();

    // ゲーム終了
    const finishButton = page.locator('.card').first().getByRole('button', { name: /終了/ });
    await expect(finishButton).toBeVisible({ timeout: 5000 });
    await finishButton.click();
    await page.waitForTimeout(500);

    // 試合終了後のセクション位置を確認
    const sectionAfter = await section.boundingBox();

    // 終了ボタン押下前後でセクションのY座標変化が最小限であること
    if (sectionBefore && sectionAfter) {
      expect(Math.abs(sectionBefore.y - sectionAfter.y)).toBeLessThanOrEqual(10);
    }
  });
});

test.describe('スコア入力画面のレイアウトジャンプ検証', () => {
  test('メンバー選択時にメッセージがinvisibleで表示されレイアウトジャンプが発生しないこと', async ({ page }) => {
    await setupTestSession(page);
    await activateAllPlayers(page);

    // 一括配置
    const assignButton = page.getByRole('button', { name: /一括配置/i });
    await expect(assignButton).toBeEnabled({ timeout: 5000 });
    await assignButton.click();
    await page.waitForTimeout(500);

    // ゲーム開始
    const gameStartButton = page.locator('.card').first().getByRole('button', { name: /開始/ });
    await expect(gameStartButton).toBeVisible({ timeout: 5000 });
    await gameStartButton.click();
    await page.waitForTimeout(500);

    // ゲーム終了
    const finishButton = page.locator('.card').first().getByRole('button', { name: /終了/ });
    await expect(finishButton).toBeVisible({ timeout: 5000 });
    await finishButton.click();
    await page.waitForTimeout(500);

    // スコア入力ボタンをクリック
    const scoreInputButton = page.getByRole('button', { name: /入力/i }).first();
    await expect(scoreInputButton).toBeVisible({ timeout: 5000 });
    await scoreInputButton.click();
    await page.waitForTimeout(500);

    // スコア入力画面でメンバー選択メッセージを確認
    const messageContainer = page.locator('.bg-indigo-50.border-indigo-200');

    // messageContainerはinvisibleでもDOM上に存在するため、count()で確認
    if (await messageContainer.count() > 0) {
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
  });
});
