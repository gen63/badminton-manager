# dev モードで作成者を変更可能に + bot セッション初回入室時の作成者自動委譲

## Context

### 背景

1. **bot 作成セッションの作成者問題**
   `scripts/auto-create-session.ts:488` で `createdBy: 'auto-session-bot'` 固定文字列が入る。`SessionJoinPage` は `session.createdBy` をそのままコピーするだけなので、誰も `isCreator()` を通過できない恒久的な「作成者不在」状態になる。dev モード権限バイパス（`sessionStore.ts:73`）で UI 操作はできるが、`session.information.updatedBy` や将来の通知等で "作成者" を識別する箇所で `auto-session-bot` が残り続ける。

2. **作成者変更手段が存在しない**
   既存セッションの `createdBy` を書き換える UI/API が無い。特に bot セッションを "引き取る" 運用ができない。

### 要望

- dev モード (`?dev=1`) 時に、現参加者から新しい作成者を選んで変更できる UI を追加
- `createdBy === 'auto-session-bot'` のセッションに最初にログインした人を自動的に作成者に昇格

## 設計方針

### bot 作成者の自動委譲

`sessionService.joinSession()` の Firestore transaction 内で判定する。transaction 内なので、複数人が同時ログインしても先着 1 人のみが `createdBy` を書き換えられる（後続は既に `'auto-session-bot'` でない状態を見るのでスキップ）。競合安全。

- transaction 内で `data.createdBy === 'auto-session-bot'` を判定
- 条件成立時、updates に `createdBy: playerName` を追加
- 戻り値に `newCreator?: string` を追加し、呼び出し側でローカル `session.createdBy` を即時更新

### dev モードの作成者変更 UI

`SettingsPage` に dev モード時のみ表示される「作成者変更」カードを追加。

- 現在の `createdBy` 表示
- 現在の `participants[]` から新作成者を**単一選択**（参加者セレクト方式）
- 確認ダイアログ → `updateCreator()` 呼び出し

参加者セレクト方式を採用（任意文字列入力ではなく）。理由：誤タイポによる恒久的な作成者不在を避けるため。bot 引き取り用途は上記「自動委譲」でカバーされるので手動変更は主に "作成者が辞めた" ケースで使う。

### API / ストア

- `sessionService.updateCreator(sessionId, newCreator)` を追加。Firestore `createdBy` のみ更新（transaction 不要：dev モード手動操作で単発）。
- `sessionStore.updateSession({ createdBy })` で既存ストア経由でローカル反映。

## 変更ファイル

### 1. `src/services/sessionService.ts`

- `joinSession()` transaction 内に auto-promotion 判定を追加
- 戻り値を `{ isAlreadyJoined: boolean; newCreator?: string }` に拡張
- `updateCreator(sessionId, newCreator)` を新設（updateDoc で `createdBy` 更新）

### 2. `src/pages/SessionJoinPage.tsx`

- `joinSession` の戻り値 `newCreator` を受け取り、`initializeSession` の `createdBy` 引数を `result.newCreator ?? session.createdBy` に

### 3. `src/pages/SettingsPage.tsx`

- dev モード時のみ表示する「作成者変更」カード
- 参加者一覧からラジオ選択 → 「変更」ボタン → confirm → `updateCreator()` → ローカル `updateSession({ createdBy })`

### 4. `scripts/auto-create-session.ts`（変更なし）

- `createdBy: 'auto-session-bot'` はそのまま残す。これが sentinel 値になる。

## 影響範囲

- bot セッションに最初に入った人が `isCreator()` で true を返すようになる（実作成者として機能開始）
- dev モードで作成者を変更すると、Firestore 書き込み権限・初回 push 権限（`useFirebaseSync.ts:306, 363`）の対象も変わる（意図通り）
- 既存の `createdBy !== 'auto-session-bot'` のセッションは影響なし

## 検証

- `npm run build` / `npm run lint` / `npm run test:run` 通過
- 手動: `auto-session-bot` のセッションに初回参加 → `createdBy` が自分になる
- 手動: `?dev=1` で SettingsPage から別参加者に作成者変更 → 即時反映、再読み込み後も維持
- 手動: 一般モードでは「作成者変更」カード非表示
