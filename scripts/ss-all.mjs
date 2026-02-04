import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }
});
const page = await context.newPage();

// 1. セッション作成画面
await page.goto('http://localhost:5173/badminton-manager/');
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/ss-1-create.png' });
console.log('1. セッション作成画面 ✓');

// 2. セッション開始 → メイン画面
await page.click('button:has-text("セッション開始")');
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/ss-2-main.png' });
console.log('2. メイン画面 ✓');

// 3. 設定画面
await page.click('button[aria-label="設定"]');
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/ss-3-settings.png' });
console.log('3. 設定画面 ✓');

// 4. 戻ってから履歴画面
await page.goBack();
await page.waitForTimeout(500);
await page.click('button[aria-label="履歴"]');
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/ss-4-history.png' });
console.log('4. 履歴画面 ✓');

await browser.close();
console.log('Done!');
