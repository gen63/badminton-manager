# Google Sheets 試合結果記録（GAS連携）

## 概要

当日の試合結果を Google スプレッドシートに記録する機能。
Google Apps Script (GAS) を中継サーバーとして使い、フロントエンドから POST するシンプルな構成。

**運用想定:** 練習中はオフライン。練習後に Wi-Fi 接続し、履歴画面からまとめてアップロード。

## アーキテクチャ

```
┌─────────────┐   POST JSON    ┌──────────────┐   書き込み   ┌────────────────────┐
│  アプリ      │ ─────────────→ │  GAS Web App  │ ──────────→ │ Google Spreadsheet │
│  (React)    │                │  doPost()     │             │                    │
└─────────────┘                └──────────────┘             └────────────────────┘
```

- バックエンド不要（GAS がプロキシ）
- OAuth・APIキー管理不要
- 送信済みフラグなし（何度でも送れる）

## スプレッドシートの列構成

| 列 | 内容 | 例 |
|----|------|----|
| A | 日付 | 2026-02-05 |
| B | 体育館 | ぴいす |
| C | 試合番号 | 1 |
| D | コート | 2 |
| E | チームA選手1 | 田中 |
| F | チームA選手2 | 鈴木 |
| G | スコアA | 21 |
| H | スコアB | 15 |
| I | チームB選手1 | 佐藤 |
| J | チームB選手2 | 山田 |
| K | 試合時間(分) | 12 |
| L | 開始時刻 | 19:30 |
| M | 終了時刻 | 19:42 |

## 送信タイミング

- **手動アップロードのみ（2箇所）**
  - **設定画面:** GAS URL 入力欄の近くにアップロードボタンを配置
  - **履歴画面:** 既存のコピーボタンの隣にアップロードボタンを配置
  - どちらも同じ動作: 全 `matchHistory` を一括送信
  - 送信成功: 「Sheetsに送信しました」トースト
  - 送信失敗: 「送信に失敗しました。Wi-Fi接続を確認してください」トースト
- 自動送信なし（普段オフラインのため）
- GAS URL 未設定時はボタン非表示（履歴画面）/ ボタン無効化（設定画面）

## GAS URL の保存先

`SessionConfig` に入れると `clearSession()` で消える。
**専用の Zustand ストア (`settingsStore`)** を新設し、セッションとは独立して永続化する。

```typescript
// src/stores/settingsStore.ts
interface SettingsState {
  gasWebAppUrl: string;
  setGasWebAppUrl: (url: string) => void;
}
// persist key: 'badminton-settings'
```

## 実装タスク

### 1. settingsStore 新設
- `src/stores/settingsStore.ts`
- `gasWebAppUrl: string` を保持
- `localStorage` に永続化（キー: `badminton-settings`）

### 2. 送信ユーティリティ
- `src/lib/sheetsApi.ts`
- `sendMatchesToSheets(url, matches, players, session)` 関数
  - Match[] を受け取り、プレイヤー名解決＆整形して POST
  - `fetch()` で GAS Web App に JSON を送信
  - タイムアウト: 10秒
  - レスポンスの成否を返す

ペイロード形式:
```typescript
interface SheetsPayload {
  matches: Array<{
    date: string;           // "2026-02-05"
    gym: string;            // "ぴいす"
    matchNumber: number;    // 1, 2, 3...
    courtId: number;        // 1, 2, 3
    teamA: [string, string]; // 選手名
    teamB: [string, string]; // 選手名
    scoreA: number;
    scoreB: number;
    duration: number;        // 分
    startedAt: string;       // "19:30"
    finishedAt: string;      // "19:42"
  }>;
}
```

### 3. 設定画面に GAS URL 入力欄 + アップロードボタン追加
- `SettingsPage.tsx` に「Google Sheets連携」セクション追加
- テキスト入力: GAS Web App URL
- URL は `https://script.google.com/` で始まることを簡易バリデーション
- URL 入力欄の近くにアップロードボタンを配置
  - URL 未入力時はボタン無効化
  - 送信中はローディング表示
  - 結果をトーストで通知

### 4. 履歴画面にアップロードボタン追加
- `HistoryPage.tsx` の既存コピーボタンの隣にアップロードボタンを配置
- 押すと全 `matchHistory` を一括送信
- 送信中はローディング表示（ボタン無効化 + スピナー）
- GAS URL 未設定時はボタン非表示
- 結果をトーストで通知

### 5. GAS スクリプト（参考実装）
- `docs/gas-script.js` にサンプルコードを配置
- ユーザーが GAS エディタに貼り付けて使う

```javascript
function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = JSON.parse(e.postData.contents);

  data.matches.forEach(match => {
    sheet.appendRow([
      match.date,
      match.gym,
      match.matchNumber,
      match.courtId,
      match.teamA[0],
      match.teamA[1],
      match.scoreA,
      match.scoreB,
      match.teamB[0],
      match.teamB[1],
      match.duration,
      match.startedAt,
      match.finishedAt,
    ]);
  });

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## 変更ファイル一覧

| ファイル | 操作 | 内容 |
|----------|------|------|
| `src/stores/settingsStore.ts` | **新規** | GAS URL 永続化ストア |
| `src/lib/sheetsApi.ts` | **新規** | 送信ロジック |
| `src/pages/SettingsPage.tsx` | 変更 | GAS URL 入力セクション追加 |
| `src/pages/HistoryPage.tsx` | 変更 | アップロードボタン追加 |
| `docs/gas-script.js` | **新規** | GAS サンプルコード |

## 設計判断

| 判断 | 理由 |
|------|------|
| settingsStore を SessionConfig と分離 | セッションリセットで URL が消えるのを防ぐ |
| 送信済みフラグなし | ユーザー要望。同じ試合を複数回送信しても GAS 側で問題ない |
| 自動送信なし・手動アップロードのみ | 普段オフラインで運用するため。Wi-Fi 接続時にまとめて送信 |
| 配列で一括送信 | 練習後にまとめて送る運用に合致 |
| GAS URL のバリデーションは簡易 | 正確な検証は困難。`https://script.google.com/` プレフィックスのみ確認 |
