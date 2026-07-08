# オートセッション作成時の固定管理者付与

日付: 2026-07-08

## 背景

自動作成セッション（`scripts/auto-create-session.ts`）は `createdBy:
'auto-session-bot'` で作成されるため、実在の参加者は誰も `isAdmin()` /
`isCreator()` を満たさず、管理者操作ができない。運営メンバーには最初から
管理者権限を与えたい。

## 方針

- `Session.admins?: string[]` は既存フィールド。`sessionStore.isAdmin()` が
  `session.admins?.includes(currentUser)` で判定済みのため、**セッション作成時に
  `admins` を埋めるだけ**で機能する。
- `scripts/auto-create-session.ts` の `buildSessionData()` に固定リスト
  `AUTO_SESSION_ADMINS` を追加し、`admins` として常に全員分を含める。
  - 参加者に含まれるかでフィルタしない: 途中参加でも管理者になれるようにする。
    参加していないメンバーが admins に載っていても実害はない（本人がその名前で
    入室しない限り権限は発生しない）。

## 対象メンバー

- げん / まさ / ゆーた(たっちゃん) / ほそや / あいだ / りょーちん♂
- **E-tomo 上の表示名と完全一致が必要**（`isAdmin()` は名前の文字列比較）。
  表記が異なる場合は `AUTO_SESSION_ADMINS` を修正する。

## 変更ファイル

- `scripts/auto-create-session.ts`: `AUTO_SESSION_ADMINS` 定数 + `buildSessionData` に `admins`
- `scripts/auto-create-session.test.ts`: admins 付与のテスト
