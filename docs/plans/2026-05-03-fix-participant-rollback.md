# 参加者管理情報の巻き戻り（field-level 3-way マージ拡張）

## Context（背景）

ユーザー報告:

> 参加者管理の情報が巻き戻ることがある、不具合原因究明お願い

スクリーンショット: 「げん」が「✓名簿」 ON、「支払」 OFF。10人中1人未完了の状態。
別の操作のあと、トグルが元に戻ってしまうケースがある。

## 根本原因（コード確証済み）

### P0: `mergeById` が players をオブジェクト全体で `JSON.stringify` 比較

`src/lib/syncUtils.ts:153`:

```ts
const localChanged = !baseItem || JSON.stringify(baseItem) !== JSON.stringify(localItem);
if (localChanged) result.push(localItem); else result.push(remoteItem);
```

`courts` は過去 plan（`2026-05-02-fix-sync-duplicates.md` / `2026-05-02-fix-court-sync-rollback.md`）で
`mergeCourt`（フィールド粒度 3-way）に置き換わったが、**players は未対応のまま**。

巻き戻り再現:
1. T0: 共通 base = `{operationStatus:{payment:false, roster:false}, paymentAmount:0}`。
2. A が「名簿」をタップ → A.local: `{roster:true}` → push、Firestore に `roster:true`。
3. A の push 未受信の B が「支払」をタップ → B.local: `{payment:true, paymentAmount:500}`。
4. B が onSnapshot で A の push を受信:
   - `JSON(base) !== JSON(local)` → local 全体採用 → **A の `roster:true` が消える**。
5. B が push → A が onSnapshot で受信:
   - `JSON(base) === JSON(local)` → remote 全体採用 → **A の `roster:true` が `false` に巻き戻る**。

既存テスト `syncUtils.test.ts:783-800` がこのバグ挙動（`// リモート名前変更はロスト`）を
**仕様として固定**しているため、修正と同時にテスト期待値も更新する必要がある。

### P1: `mergeMatchHistory` も同じ JSON 全体比較

`src/lib/syncUtils.ts:478`:

同じ試合の `scoreA` / `scoreB` を 2 人が同時編集 → 一方が必ずロスト → 後発 push で巻き戻り。
今回の症状ではないが、同じパターンなので同じ修正手法で吸収する。
既存テスト `syncUtils.test.ts:804-821` も同様にバグ挙動を固定。

### P2: `reservations` も `mergeById` 直接利用

`src/lib/syncUtils.ts:558`:

予約の名前・支払額・性別等を 2 端末で同時編集すると同様に巻き戻る。
今回の症状ではないが同じ修正で吸収。

### S1: finishGame と参加者トグルの同時操作で二重ロールバック

`src/services/sessionService.ts:469`、`src/pages/MainPage.tsx:949-967`

`finishGameTransaction` の `computeNewState(remoteState)` は **リモート状態から** 新状態を再計算する。
A の未 push の `payment:true` は writtenState に取り込まれない →
`completeDirectTransaction(writtenState)` で `lastSyncedState = writtenState` →
A の次の push で P0（whole-object）により A の local を全採用 → **B の `gamesPlayed +1` 巻き戻り**。

P0 修正で field-level マージにすれば自動的に解消される（連鎖治癒）ため、
S1 単独の追加修正は不要。

### S2: optimistic finishGame が React render 時の stale `players` を読む

`src/pages/MainPage.tsx:906-912`:

```ts
const player = players.find((p) => p.id === playerId);  // render時closure
if (player) {
  updatePlayer(playerId, { gamesPlayed: player.gamesPlayed + 1, lastPlayedAt: Date.now() });
}
```

`players` がコンポーネント render の captured 値。直前に onSnapshot で
`gamesPlayed` が進んでいると stale +1 を上書きする恐れ。実害はレアケースだが
正しさのため `usePlayerStore.getState()` から fresh に読むべき。

### S3: `handlePaymentConfirm` が 2-step setState

`src/pages/PlayerSelect.tsx:107-117`、`src/pages/MainPage.tsx:354-364`:

`setPaymentAmount` → `toggleOperationStatus` の 2 回 setState。
P0 修正後は巻き戻りには影響しないが、論理的には 1 トランザクション。
playerStore に atomic な `applyPayment(id, amount)` を新設して 1 回に集約する。

---

## 修正方針

### Step 1: 汎用 field-level 3-way ヘルパーを `syncUtils.ts` に追加

```ts
// 1段ネストオブジェクトの sub-field 3-way（operationStatus 用）
function mergeNestedObject<T extends Record<string, unknown>>(
  base: T | undefined, local: T | undefined, remote: T | undefined,
): T | undefined;

// 単一エンティティの field-level 3-way（指定キーは nested 扱い）
function mergeEntity<T extends { id: string | number }>(
  base: T | undefined, local: T, remote: T,
  options?: { nestedKeys?: (keyof T)[] },
): T;

// id ベース配列の field-level 3-way（mergeById のフィールド粒度版）
function mergeEntitiesById<T extends { id: string | number }>(
  base: T[] | undefined, local: T[], remote: T[],
  options?: { nestedKeys?: (keyof T)[] },
): T[];
```

優先度ルール:
- 各フィールドで `JSON(base) !== JSON(local)` なら local 採用（local-changed）、
  そうでなければ remote 採用（mergeCourt のスカラ部と同じセマンティクス）。
- ネストキーは sub-field ごとに同じ判定。
- 配列の追加/削除セマンティクス（base 比較で「local-only=追加」「base にあって remote 消失=削除」）は
  既存 `mergeById` と完全に同じ。

### Step 2: `mergeGameState` の差し替え

```ts
players: mergeEntitiesById(base.players, local.players, remote.players, {
  nestedKeys: ['operationStatus'],
}),
matchHistory: mergeMatchHistory(base.matchHistory, local.matchHistory, remote.matchHistory),
reservations: mergeEntitiesById(base.reservations, local.reservations, remote.reservations),
```

`mergeMatchHistory` は `mergeEntitiesById` を内部利用しつつ `startedAt` 昇順ソートを維持する。
`mergeById` は他から呼ばれていないので未使用関数として削除。

### Step 3: playerStore に `applyPayment` / `incrementGamesPlayed` を追加（S2/S3）

```ts
applyPayment(id, amount): paymentAmount + operationStatus.payment トグル + paymentTimestamp を 1 setState で。
incrementGamesPlayed(ids[], lastPlayedAt): 全該当プレイヤーの gamesPlayed をストア状態から fresh に +1。
```

`PlayerSelect.tsx` / `MainPage.tsx` の `handlePaymentConfirm` を `applyPayment` に置換。
`MainPage.tsx` の finishGame 楽観更新を `incrementGamesPlayed` に置換。

---

## 修正対象ファイル

- **`src/lib/syncUtils.ts`**（メイン修正）
  - 追加: `mergeNestedObject` / `mergeEntity` / `mergeEntitiesById`
  - 修正: `mergeMatchHistory` を field-level に書き換え（startedAt ソートは維持）
  - 修正: `mergeGameState` を新ヘルパー経由に
  - 削除: 未使用になる `mergeById`
- **`src/lib/syncUtils.test.ts`**
  - 期待値変更: `:743`「同じプレイヤーの異なるフィールドを同時編集」→ 両方反映
  - 期待値変更: `:783`「支払い情報とプレイヤー編集の同時操作」→ name 変更も反映
  - 既存テスト `:804-821`「同じ試合のスコアを2人が同時編集」は scoreA/scoreB が
    ともに base から変わっているのでローカル優先が引き続き成立（変更不要）。
  - 新規追加: payment/roster/checkin の独立 3-way、paymentAmount × name 同時、
    finishGame × payment トグル並行、reservation 別フィールド並行 等。
- **`src/stores/playerStore.ts`**
  - 追加: `applyPayment(id, amount)`, `incrementGamesPlayed(ids[], lastPlayedAt)`
- **`src/pages/PlayerSelect.tsx`**
  - `handlePaymentConfirm` を `applyPayment` に書き換え
- **`src/pages/MainPage.tsx`**
  - `handlePaymentConfirm` を `applyPayment` に書き換え
  - finishGame 楽観更新（行 905-913）を `incrementGamesPlayed` に書き換え

---

## 検証

```bash
npm run build    # tsc -b && vite build
npm run lint     # eslint .
npm run test:run # vitest
```

### 手動検証（推奨）
2 つのブラウザ/タブで同じセッションに参加し、ネットワーク遅延を再現するため両方を開いた状態で:

1. **参加者トグル並行**: 片方が「名簿」、もう片方が「支払」を同じ参加者に同時にタップ →
   両方の変更が両画面で残ること。
2. **試合終了 × 支払**: 片方が試合中コートで「終了」、もう片方が試合参加プレイヤーの「支払」 →
   `gamesPlayed +1` と `payment:true` の両方が両画面に残ること。
3. **スコア並行編集**: 同じ試合の `scoreA` を片方が、`scoreB` をもう片方が編集 →
   両方反映されること（既存テスト挙動維持）。
4. **リグレッション**: コート関連の既存修正（`2026-05-02-fix-court-sync-rollback.md` 等）が
   引き続き機能すること。
