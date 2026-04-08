# E-tomoスクレイピング → セッション自動作成

## 概要

GitHub Actionsで毎日朝6時(JST)に起動し、E-tomoから翌日の開催予定を取得。
参加予定メンバーのレーティング・性別をGoogleスプレッドシートから補完し、
Firebaseにセッションを自動作成する。

## フロー

```
06:00 JST cron起動
  ├─ E-tomoイベント一覧スクレイピング（Shift_JIS対応）
  ├─ 翌日イベントをフィルタ（単/複/楽、目白除外）
  ├─ イベント詳細ページから参加予定メンバー取得
  ├─ GAS Web Appからレーティング・性別取得
  ├─ Firestoreで作成済みチェック（etomoEventId重複防止）
  │
  ├─ 不明点なし → 即時セッション作成 → Discord通知「✅ 完了」
  └─ 不明点あり → Discord通知「⚠️ 要確認」
       └─ 管理者がスプレッドシート修正 → 手動リラン → 作成
```

## 不明点の定義

- スプレッドシートに名前が見つからない
- レーティングが未設定
- 性別が未設定

## ファイル構成

- `scripts/auto-create-session.ts` — メインスクリプト
- `.github/workflows/auto-session.yml` — cron + workflow_dispatch

## 必要なGitHub Secrets

| Secret | 説明 |
|--------|------|
| `ETOMO_URL` | E-tomo認証付きURL（新規） |
| `GAS_WEB_APP_URL` | メンバーデータGAS URL（新規） |
| `DISCORD_WEBHOOK_URL` | Discord Webhook URL（新規） |
| `VITE_FIREBASE_*` | Firebase設定（既存） |

## 技術的な決定事項

- **Firebase Web SDK**を使用（firebase-adminではない）。既存依存をそのまま利用。
- **Shift_JIS対応**: `iconv-lite`でデコード（devDependency）。
- **重複防止**: セッションに`etomoEventId`フィールドを追加し、同じイベントの二重作成を防止。
- **1日複数イベント対応**: イベントごとに個別処理。
- **手動リラン時**: `FORCE_CREATE=true`で不明点があっても強制作成。
