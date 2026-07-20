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

## 追記（2026-07-20 フォローアップ）: 試合終了時に確定させる

### 問題

上記の再発火は MainPage の **60 秒ポーリング**でしか走らない。試合終了時
（`computeFinishAndContinue`）は出場者を **待機（`isResting: false`）** に戻すため、
ボーダー超過済みの未対応メンバーも一旦待機に戻り、**次のポーリングまでの最大
60 秒の隙間**に連続配置（continuous mode）や手動再投入で再出場してしまう。
特に **単（singles, 1 コート 2 人）** は待機プールが小さく回転が速いので、
ポーリングが競合に負けて「毎試合ごとの強制休憩が効かない」ように見える。

### 対策（イベント駆動で確定）

`src/lib/gameOperations.ts` の `computeFinishAndContinue` で、出場者のうち
**`forcedRestAt` がセット済み（＝一度ボーダー超過）かつ会費/名簿が未対応** の
メンバーは、試合終了時に待機ではなく **強制休憩（`isResting: true`）へ戻す**。
同時に `forcedRestAt` を now に更新し、`useFirebaseSync` の onSnapshot 通知を
再発火させる。これにより:

- 連続配置の `waitingPlayers` フィルタ（`!isResting`）から確実に外れ、
  次の自動配置に選ばれない。
- ポーリングの隙間に依存せず **試合終了と同時に**確定する（毎試合ごと）。
- 初回（`forcedRestAt` 未設定）は従来どおり待機に戻し、30 分猶予の初回発火は
  ポーリング側に委ねる。
- 循環 import を避けるため `hasUnresolvedOps`（`unresolvedOpsOf` 相当）を
  gameOperations 内に小さく持つ。
- べき等: 更新後の `forcedRestAt` は同試合の `finishedAt` と同値になるため、
  ポーリングの再発火（`last <= forcedRestAt`）は空振りし二重書き込みしない。

## 確認

- `npm run build` / `npm run lint` / `npm run test:run`
- `sessionMutations.test.ts` に再発火のユニットテストを追加:
  - `forcedRestAt` 後に終了した試合があれば再発火し `forcedRestAt` を更新する
  - `forcedRestAt` 後に新しい試合が無ければ再発火しない（既存テスト踏襲）
  - 再発火対象でもコート上なら引き剥がさない
- `gameOperations.test.ts` に試合終了時強制休憩のテストを追加:
  - ボーダー超過済み＋未対応 → 休憩へ戻し `forcedRestAt` 更新
  - `forcedRestAt` 未設定 → 休憩にしない（初回はポーリング）
  - 対応済み → `forcedRestAt` が残っていても休憩にしない
  - 単・連続モードで強制休憩者が次の自動配置に選ばれない
