# 設定画面の整理（目標点数・オンラインモード表記・セッション情報の削除）

日付: 2026-07-14
ブランチ: `claude/settings-screen-cleanup-65f77p`

## 背景

- 目標点数はかつて 15 / 21 を切り替えて運用していたが、現在は 15 しか使わない。
  設定 UI として残す意味がなくなった。
- 本アプリはオンラインモード専用（オフラインモードは存在しない）ため、
  設定画面の「オンラインモード」カードは情報価値がない。
- 「セッション情報」カード（管理者・セッション ID・参加者数の表示）は
  現在使われておらず、削除してよいと確認済み。

## 方針

### 1. 目標点数設定の削除（値は 15 固定を維持）

`session.config.targetScore` は ScoreInputPage の勝敗・デュース判定
（`getMaxScore` / `validateScore`）が読み続けるため、**型・Firestore の
フィールドは削除しない**。値の供給元は以下の通りすべて 15 固定で維持:

- `SessionCreate.tsx` — 既に `useState(15)` で 15 固定（変更不要）
- `scripts/auto-create-session.ts` — 既に `targetScore: 15`（変更不要）

変更点:

- `src/pages/SettingsPage.tsx`
  - 「コート設定」カード内の「目標点数」ブロック（269-287 行付近）を削除
  - `handleTargetScoreChange`（75-77 行付近）を削除
- `src/pages/ScoreInputPage.tsx:21`
  - フォールバックを `session?.config.targetScore || 21` → `|| 15` に変更
    （config 欠損時も 15 運用に一致させる）

型 `SessionConfig.targetScore` を必須のまま残すことで、既存テスト fixture
（sessionStore.test.ts / useFirebaseSync.test.ts / sheetsApi.test.ts /
uploadStatus.test.ts の `targetScore: 21`）は無改修で通る。

### 2. 「オンラインモード」表記の削除

モード切替ロジックはもともと存在せず、表示文言のみ:

- `src/pages/SettingsPage.tsx:475-488` — 同期ステータスカード
  （`<h3>オンラインモード</h3>`）をカードごと削除。
  `Wifi` アイコンの import はこのカード専用のため併せて削除。
- `src/pages/SettingsPage.tsx:96,120` — リセット確認ダイアログの
  「※オンラインモードの場合、他の参加者も影響を受けます」は、常時オンライン
  前提の文言「※他の参加者も影響を受けます」に変更（警告自体は有用なので残す）。

**触らないもの**（名前が似ているだけの実ロジック）:
`SessionJoinPage.tsx` の `isSameOnlineSession`、
`useFirebaseSync.ts` の `window 'online'` イベント購読。

### 3. 「セッション情報」カードの削除

- `src/pages/SettingsPage.tsx:490-526` — `{userIsAdmin && (...)}` の
  「セッション情報」カードを削除。表示専用で外部依存なし。
- 付随して削除: `sessionIdCopied` state（27 行付近）、
  `handleCopySessionId`（79-84 行付近）、`Copy` アイコン import。
- `Check` / `Shield` の import は他セクション（管理者管理モーダル等）で
  使用中のため**残す**。

**混同注意**: `session.information` / `SessionInformation` 型は
「周知事項（お知らせ）」機能で別物。今回の削除対象外。

## 受け入れ確認

- `npm run build` / `npm run lint` / `npm run test:run` がすべて通ること
- 設定画面に「目標点数」「オンラインモード」「セッション情報」が
  表示されないこと
- スコア入力の勝敗・デュース判定が従来通り 15 点（デュース上限 21 点）で
  動作すること（`config.targetScore = 15` を読み続ける）
