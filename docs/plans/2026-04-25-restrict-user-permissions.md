# 一般ユーザの操作権限を狭める

## 背景

オンラインモードでセッションを共有しているとき、作成者・管理者以外（一般ユーザ）が誤って下記の重要操作を行ってしまうケースが報告された。

- 連続モード（continuousMatchMode）の手動 ON/OFF
- コートの追加（`+ コート追加`）
- コートの削除（コート右上の `−` ボタン）

これらは試合進行全体に影響する操作のため、isAdmin（作成者または admins に含まれるユーザ）に限定する。

## 仕様

権限境界は **isAdmin**（既存の `useSessionStore().isAdmin()`）を再利用する。

| 操作 | 一般ユーザ | 管理者 / 作成者 / dev mode / ローカルモード |
| ---- | ---------- | -------------------------------------- |
| 「連続」トグル | 非表示 | 表示・操作可 |
| 「+ コート追加」 | 非表示 | 表示・操作可 |
| 「− コート削除」 | 非表示 | 表示・操作可 |

`isAdmin()` の既存仕様により、以下のケースは管理者扱いとなる：
- ローカルモード（`session.createdBy` が無い）
- dev mode（`localStorage['dev-mode'] === '1'`）
- セッション作成者（`currentUser === session.createdBy`）
- セッションの admins 配列に含まれるユーザ

### 表示方針：disabled ではなく非表示

操作意図のないユーザにグレーアウトボタンを見せると混乱を招くため、**非表示**で扱う。`isAdmin()` 切替時は React の再レンダリングで自然に表示が出入りする。

### コート追加削除のレイアウト保持

コート削除（`−`）は `<div className="shrink-0 flex justify-end">` の中にあり、再生中は CourtTimer に置き換わる。一般ユーザの場合は「再生中でなく `courts.length > 1`」のときに `<div>` の中身を空にする。レイアウト崩れは無し。

「+ コート追加」ボタンは `courts.map(...)` のあとの兄弟要素なので、丸ごと条件付きレンダリングで OK。

## 実装

`src/pages/MainPage.tsx` のみ変更。

1. **連続トグル (L630-646)**: `{isAdmin() && (<button>…連続…</button>)}` でラップ。
2. **コート削除 `−` (L811-819)**: 既存条件 `!hasPlayers && courts.length > 1` に `&& isAdmin()` を追加。
3. **コート追加 `+` (L1023-1038)**: 既存条件 `courts.length < 3` に `&& isAdmin()` を追加。

`isAdmin` は L34 で既に分割代入されているため、追加 import は不要。

## 影響範囲

- ローカルモード（共有していない単独利用）は `isAdmin()` が常に true → 既存動作維持
- dev mode (`?dev=1`) は常に true → 既存動作維持
- 自動コート調整（`autoAdjustCourts` 系）は別経路（`updateConfig()` / `resizeCourts()`）で動くため、UI ボタン非表示でも自動調整は引き続き動作する

## チェック項目

- `npm run build`
- `npm run lint`
- `npm run test:run`
