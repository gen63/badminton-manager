# メンバー名変更後に「未参加」表示になる不具合の修正

## 症状

セッション参加後、管理者がプレイヤーの名前を変更すると、`SessionJoinPage` の
メンバー一覧で当該メンバーが「未入室」扱いで表示される。

## 原因

参加状態は **名前ベース**で管理されている。

- `session.participants: string[]` — 入室済みメンバーの名前リスト
- `session.gameState.players[].name` — プレイヤー名（rename 対象）
- `session.registeredPlayers: string[]` — `players.map(p => p.name)` の派生

`updatePlayer` 経由の rename は `gameState.players[].name`（および派生の
`registeredPlayers`）のみ更新する。`session.participants` は更新されない。
結果として `joinedNames = Set(participants)` には旧名が、`registeredPlayers`
には新名が入り、`SessionJoinPage` で renamed プレイヤーが「未入室」として
表示される（`SessionJoinPage.tsx:259-270`）。

同根の問題として `session.admins[]` / `session.createdBy` も名前ベースのため、
rename すると admin 権限 / 作成者判定が壊れる。

## 修正方針

`updatePlayer` トランザクションを `mutateGameState` 汎用ラッパーから外し、
`gameState.players` の名前変更を検出した場合は同一トランザクション内で
session レベルの **`participants` / `admins` / `createdBy`** も新名に
書き換える。

- 純関数 `computeUpdatePlayer` は変更しない（`GameState` のみ扱う設計を維持）。
- session レベルの参照は名前ベースのまま（ID 化は別途検討）。
- Presence (`presence[oldName]`) は heartbeat TTL で自然に消えるため触らない。
- `information.updatedBy` / `information.readBy` は履歴的記録のため触らない。

## テスト

`sessionMutations.test.ts` に rename 時の wrapper テストを追加:
- 名前未変更時: `participants` / `admins` / `createdBy` を書き換えない
- 名前変更時: 旧名を含む `participants` / `admins` / `createdBy` を新名へ置換
- 名前変更時: 旧名を含まない場合は当該フィールドを書き換えない

## スコープ外（将来検討）

- localStorage `currentUser` の自動同期（自己 rename 時に旧名のままになる問題）
- `participants` / `admins` / `createdBy` の **player ID ベース化**
  （より根本的だが、Firestore document の互換性破壊を伴うため別 plan で）
