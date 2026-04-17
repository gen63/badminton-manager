# 開発モードにセッション作成者権限を付与 + セッション有効期限の延長

## Context

本タスクは 2 件の関連する改修を合わせて行う。

### 1. 開発モードへのセッション作成者権限付与

現在の権限体系：

- **セッション作成者** (`isCreator()`) — 管理者管理（追加・削除）、セッション削除、Firestore への初回 push、期限切れセッション削除などの強い権限
- **管理者** (`isAdmin()`) — 作成者 OR `session.admins[]` に含まれるユーザー。会計操作・お知らせ編集・各種リセット等
- **開発モード** (`useDevMode()`) — `?dev=1` で localStorage に有効フラグ保存。現状は `SettingsPage` の隠し「セッション削除」ボタンと `SessionSelectPage` のアーカイブ表示のみ

問題：開発者が他人が作ったセッションで検証・メンテナンスするとき、作成者権限を持つ UI 操作（管理者追加、お知らせ編集、各種リセット等）にアクセスできない。開発モード有効時には作成者と同等の権限を与えたい。

### 2. セッション自動削除までの期間延長（5日 → 1か月）

現在 `useFirebaseSync.ts:355` で `TTL = 5 * 24 * 60 * 60 * 1000`（5日間）。
最終アクセスから 5 日経過したセッションが自動削除されるが、期間が短すぎて
月次のグループでは復帰前に消えてしまうケースがある。1 か月 (30 日) に延長する。

### 非対象

- Firestore セキュリティルール上の権限は変更しない（これまで通り `deleteSession()` などが通る範囲内での UI 操作のみ）
- `useFirebaseSync.ts` の初回 push / 期限切れ削除の `isCreator` チェックは "本当の作成者の責務" であり、競合防止のためそのまま残す
- 12 時間自動アーカイブ（`docs/plans/2026-04-17-session-auto-archive.md`）はそのまま。今回伸ばすのは "削除" までの期間のみ

## 設計方針

- 権限判定の中心である `src/stores/sessionStore.ts` の `isCreator()` / `isAdmin()` 2 関数に dev mode バイパスを追加する
- これにより `userIsCreator` / `userIsAdmin` で gating されている SettingsPage の「管理者管理」カードや、BottomNav の会計タブ表示、AccountingPage・MainPage・HistoryPage の admin 判定が自動的に dev mode に追従する
- Zustand store から `localStorage` を直接参照する形にする（`useDevMode` フックは React コンポーネント専用で、ストア関数からは呼べないため）

## 変更ファイル

### 1. `src/stores/sessionStore.ts`

- モジュールトップに `isDevMode()` ヘルパーを追加（localStorage の `'dev-mode'` キーを直読み、SSR/例外に備えて try/catch）
- `isCreator()` / `isAdmin()` にそれぞれ `if (isDevMode()) return true;` を追加

### 2. `src/pages/SettingsPage.tsx` — 既存バグ修正

L58 の管理者ガードが関数参照 `!isAdmin` のままで常に false、リダイレクトが効いていなかった。
既に L29 で計算済みの `userIsAdmin` を使うように修正する。

### 3. `src/hooks/useFirebaseSync.ts` — TTL を 1 か月に延長

- コメント「5日間経過判定」→「1か月経過判定」
- `TTL = 5 * 24 * 60 * 60 * 1000` → `30 * 24 * 60 * 60 * 1000`
- トースト「最終アクセスから5日間」→「最終アクセスから1か月」

## 影響範囲

dev mode 有効時、以下が自動的に利用可能になる：

- `SettingsPage` 管理者管理カード（`userIsCreator` gate）
- `SettingsPage` 全リセット（`userIsAdmin` gate）
- `SettingsPage` 管理者限定ページへのアクセス
- `BottomNav` 会計タブ表示
- `AccountingPage` 会計編集 UI
- `MainPage` お知らせ編集等
- `HistoryPage` 履歴の削除操作
- `PlayerSelect`（tab mode）参加者編集

影響しない（意図通り）：

- `useFirebaseSync.ts:306, 363` 実作成者のみが行うべき初回 push / 期限切れ削除

## 検証

- `npm run build` / `npm run lint` / `npm run test:run` 通過
- 手動：`?dev=1` 有効で別参加者として設定画面・会計タブ・お知らせ編集が操作可能
- 非 dev mode の一般参加者には従来通り制限が効く
- TTL 延長後、`updatedAt` が 5〜29 日前のセッションが開けるようになる
