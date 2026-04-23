# バグ報告機能の追加 — Discord Webhook 送信

## Context

メイン画面からユーザー（管理者・メンバー問わず）がアプリの不具合を報告できる手段が無く、フィードバック収集が口頭/SNS頼みになっている。お知らせ機能と並列に「バグ報告」UIを設けて、テンプレ入力済みの簡易フォームから所定の Discord チャンネルへ Webhook 経由で投稿できるようにする。

## 設計方針

- 既存の「お知らせモーダル」(`MainPage.tsx`) と同型のモーダル UI を新設し、見た目とインタラクションを揃える（学習コスト最小化）。
- 送信は GAS 連携 (`src/lib/sheetsApi.ts`) と同様にフロントから `fetch` で直接 POST。Discord Webhook は CORS を許可しているため `mode: 'no-cors'` は不要、レスポンス検証可能。
- Webhook URL は Vite の環境変数 `VITE_DISCORD_WEBHOOK_URL` で注入。`firebase.ts` と同じく未設定時は空文字フォールバックして送信エラーをトースト表示する（ビルドは通る）。
- バグ報告ボタンはオフライン/未ログインでも使えるよう **常に表示** する（お知らせはオンラインのみだが、バグ報告は常時必要）。

## 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `src/lib/bugReport.ts` | **新規**。`sendBugReportToDiscord(webhookUrl, text, meta)` を export。`fetch` POST で Discord Webhook に送信。10秒で `AbortController` タイムアウト。`{ success, message }` を返す |
| `src/pages/MainPage.tsx` | (1) `MessageSquare` を `lucide-react` import に追加。(2) state追加: `showBugReportModal`, `bugReportText`, `isSendingBugReport`、テンプレ定数 `BUG_REPORT_TEMPLATE`。(3) お知らせボタンの直後にバグ報告ボタンを配置（常に表示）。(4) お知らせモーダルの直後にバグ報告モーダルを追加 |

`.env.example` はプロジェクトに前例なし（Firebase用も未配置）のため追加せず、運用は README / 開発者間で共有する想定。

## バグ報告モーダルの仕様

- ヘッダー: `MessageSquare` アイコン（青系、お知らせの `Info` と同色トーン）+ "バグ報告" + ✕閉じる
- textarea: お知らせと同じ `min-h-[200px]`、初期値テンプレート:
  ```
  発生画面：
  期待値：
  実際：
  ```
- ボタン: 「キャンセル」「送信」（2列、お知らせの「キャンセル」「保存」と同じ `btn-secondary` / `btn-primary`）
- 送信中: ボタン disable + ラベル "送信中..."
- 送信後: 成功 → トースト表示しモーダルを閉じテンプレートにリセット。失敗 → エラートースト、モーダルは開いたままテキスト保持
- 空送信: trim 後空文字なら送信せずエラートースト

## Discord ペイロード

```ts
{
  content: [
    "🐛 **バグ報告**",
    "",
    text,                                // 本文（テンプレ込みのユーザー入力）
    "",
    "---",
    `👤 ユーザー: ${currentUser ?? '(未ログイン)'}`,
    `🗂 セッション: ${gym ?? '(なし)'} (${sessionId ?? '-'})`,
    `🕒 ${new Date().toISOString()}`,
    `🖥 ${navigator.userAgent}`,
    `📐 ${window.innerWidth}×${window.innerHeight}`,
  ].join("\n")
}
```

`Session` 型に `name` フィールドが無いため `session.config.gym` を識別子として使用。Discord の `content` は2000文字制限。本文と合わせて超える場合は本文を末尾切り詰め（`...`付与）。

## 再利用する既存パターン / 関数

- モーダル骨格・スタイル: `MainPage.tsx` のお知らせモーダル
- `useToast` (`src/hooks/useToast`) でトースト表示
- `AbortController` + 10秒タイムアウトのfetchパターン: `src/lib/sheetsApi.ts:sendMatchesToSheets`
- 環境変数フォールバック: `src/lib/firebase.ts` の `import.meta.env.VITE_*` パターン
- `useSessionStore` から `session`, `currentUser` 取得（既に MainPage で取得済み）

## スコープ外

- バグ報告履歴の保存（Firestore に残す等）
- 添付ファイル（スクリーンショット）対応
- バックエンド経由の送信（Webhook URL 秘匿）
- 多言語化

## 検証

1. **環境準備**:
   - Discord で適当なチャンネルに Webhook を作成
   - `.env.local` に `VITE_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/.../...` を追記
2. **動作確認** (`npm run dev` 起動後):
   - メイン画面のお知らせアイコン右に `MessageSquare` アイコンが表示される
   - オフライン/オンライン両方で表示される
   - クリックでモーダルが開き、テンプレ3行が初期入力されている
   - 送信ボタン押下で Discord にメッセージが届き、トーストが出る
   - 環境変数未設定で送信→エラートースト
   - ネットワーク切断状態で送信→エラートースト、モーダルは開いたまま
3. **コミット前チェック** (CLAUDE.md 準拠):
   ```bash
   npm run build
   npm run lint
   npm run test:run
   ```
