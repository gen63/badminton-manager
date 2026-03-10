import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // 同期テストは順次実行
  forbidOnly: !!process.env.CI,
  retries: 0, // 同期テストは再試行しない（フレイキーを許容しない）
  workers: 1, // シングルワーカーで実行
  reporter: [['list'], ['html', { outputFolder: 'playwright-report' }]],
  
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  
  timeout: 60000, // テスト全体のタイムアウト
  
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
