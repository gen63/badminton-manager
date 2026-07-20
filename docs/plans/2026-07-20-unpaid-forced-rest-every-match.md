# 未対応メンバーの「毎試合ごと」強制休憩（ボーダー超過後の再発火）

2026-07-20

## 背景 / 要望

- 既存機能（`docs/plans/2026-07-09-unpaid-auto-rest.md`）:
  会費・名簿が未対応のメンバーは「最初の試合終了から 30 分（`FORCED_REST_GRACE_MS`）」
  経過すると **一度だけ** 強制休憩になる（`Player.forcedRestAt` がべき等マーカー）。
- 要望: **一度ボーダーを超えて休憩になった後**、未払い（または名簿未済）が
  解消されていない場合は、**毎試合ごと** 強制休憩にしたい。
  - 現状は `forcedRestAt` がセット済みだと二度と再発火しないため、管理者が
    休憩を解除して再度コートに入れる／予約経由で再出場すると、以降は
    未対応のままでも自動休憩がかからない。

## 現状把握

- `computeEnforceForcedRest`（`src/services/sessionMutations.ts`）:
  - `unresolvedOpsOf(p)` が空でない（会費 or 名簿が未対応）
  - `p.forcedRestAt` が未セット（← ここで再発火をブロックしている）
  - 最初の試合終了から `FORCED_REST_GRACE_MS` 経過
  - コート上にいない
  - を満たすメンバーに `isResting: true` + `forcedRestAt: now` をセット。
- 通知（`useFirebaseSync.checkForcedRestNotifications`）は
  `${playerId}-${forcedRestAt}` をキーに重複防止し、`forcedRestAt` が
  2 分以内のものだけ通知する。→ `forcedRestAt` を更新すれば新しい通知が出る。

## 設計

`computeEnforceForcedRest` を「初回」と「再発火」の 2 経路に分ける。
既存の定数・戻り値・通知経路・トランザクションはそのまま流用する。

- 共通の除外条件（先に評価）:
  - `unresolvedOpsOf(p).length === 0` → 対象外（対応済み）
  - コート上にいる（試合中）→ 引き剥がさない。次回チェックで対象化。
- **初回**（`forcedRestAt` 未セット）: 現行どおり。
  「最初の出場試合の終了（最古 `finishedAt`）」から `FORCED_REST_GRACE_MS`
  経過で発火。
- **再発火**（`forcedRestAt` セット済み）: **新設**。
  前回の強制休憩（`forcedRestAt`）より後に終了した本人出場試合が
  1 つでもあれば発火（= ボーダー超過後にもう 1 試合こなした）。
  猶予時間は課さない（要望どおり「毎試合ごと」）。
  - べき等性: 発火時に `forcedRestAt` を `now` に更新するため、その試合の
    `finishedAt (< now)` は次回チェックでは「前回休憩より前」になり、
    毎分チェックで連打されない。次の新しい試合を消化して初めて再発火する。

実装は各プレイヤーの「最新の本人出場試合終了時刻（`lastFinishedAt`）」を
matchHistory から求め、再発火判定に使う（初回判定用の `firstFinishedAt` と
同じループで収集）。

## スコープ外 / 据え置き

- 結果未登録試合の強制休憩（`computeEnforceUnrecordedRest`）は変更しない。
- 通知文言は既存のまま流用（「会費の支払い…がまだのため休憩になりました」）。
- 対応完了時の自動「待機」復帰は行わない（従来どおり手動運用）。

## 確認

- `npm run build` / `npm run lint` / `npm run test:run`
- `sessionMutations.test.ts` に再発火のユニットテストを追加:
  - `forcedRestAt` 後に終了した試合があれば再発火し `forcedRestAt` を更新する
  - `forcedRestAt` 後に新しい試合が無ければ再発火しない（既存テスト踏襲）
  - 再発火対象でもコート上なら引き剥がさない
