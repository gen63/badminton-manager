# セッション選択画面の追加

## 概要

PWAのスタート画面として、最近アクティブなセッション5件を一覧表示するセッション選択画面を追加する。
ユーザーはワンタップでセッションに入室できるようになる。

## 背景

- 現在のスタート画面（SessionCreate）はセッション作成画面であり、既存セッションへの参加にはセッションIDの手入力が必要
- 多くのユーザーは既存セッションに参加するだけなので、最近のセッションを一覧から選べるとUXが向上する

## 設計

### 新規ファイル
- `src/pages/SessionSelectPage.tsx` - セッション選択画面

### 変更ファイル
- `src/services/sessionService.ts` - `listRecentActiveSessions()` 追加
- `src/App.tsx` - ルーティング変更（`/` → SessionSelectPage）
- `vite.config.ts` - PWA `start_url` を `/badminton-manager/sessions` に変更

### Firestoreクエリ
```
collection: sessions
where: status == 'active'
orderBy: updatedAt desc
limit: 5
```

### UI構成
- ヘッダー: アプリ名
- セッションカード一覧（最大5件）
  - 各カード: 体育館名、日付、参加者数、セッションID
  - タップ → `/session/:sessionId` へ遷移
- フッター: 「新しいセッションを開始」ボタン → SessionCreate
- Firebase未設定時 / セッション0件時: 従来のSessionCreateへリダイレクト
- ローディング状態: スケルトンUI

### ルーティング
| パス | コンポーネント |
|------|---------------|
| `/` | SessionSelectPage（新規） |
| `/sessions` | SessionSelectPage（新規） |
| `/session/create` | SessionCreate（既存） |
| `/local` | SessionCreate（既存、ローカルモード） |

## テスト計画
- Firebase未設定時にSessionCreateへリダイレクトされること
- セッション0件時に適切な空状態UIが表示されること
- ビルド・lint・既存テストが通ること
