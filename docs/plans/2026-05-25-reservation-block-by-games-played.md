# 予約メンバーの試合数による予約保留

2026-05-25

## 背景 / 課題

現状、予約（reservation）に入れたメンバーは `assignCourts` の処理順で**通常配置より完全に優先**され、優先度スコア（待ち時間・試合回数）を一切無視して試合に入る（`src/lib/algorithm.ts` の予約配置フロー）。

これは意図と異なる。試合数の多い人が予約を使って順番を飛ばし続けられてしまうため、「すでに十分試合をしている予約メンバーは、しばらく試合に入れないようにする」フェアネス制限を入れたい。

あわせて、`pendingReservations` が `orderNumber` で明示ソートされていなかった件（Firestore 同期で配列順が前後し得る）も修正する。→ **対応済み**（`algorithm.ts:886` で `orderNumber` 昇順ソート）。

## 決定事項（ユーザー合意済み）

- **基準値: 中央値（median）** — 外れ値に強く少人数でも安定。
- **閾値は設定画面で変更可能（+1 / +2 / +3）** — デフォルト **+2**。
- **予約メンバーの誰か1人でも `gamesPlayed >= median + 閾値` なら、その予約全体を保留**（今回はスキップ。pending のまま残り、他の人が追いついて median が上がれば成立）。
- 当初案の「+1 ハードブロック」は強すぎると判断（自然なばらつきで上位半数近くが対象になる／既存 `assign2CourtsHolistic` の `avg+3` 除外と不整合）。設定可能にして緩和。

## 同期スコープ

`lateBalanceMode` と同じ **Firestore 同期設定（`SyncSettings`）** にする。理由: 予約は全員が共有する概念で、配置を起動する端末によって挙動が変わるのは混乱を招くため、セッション共通であるべき。

## 中央値の母集団

`options.allPlayers ?? activePlayers`（= 休憩除く全アクティブプレイヤー、他コートでプレイ中も含む）。`lateBalance` の `maxGamesPlayed` と母集団を揃え、待機者一覧の変動に影響されない安定値にする。

## 変更ファイル

1. `src/services/sessionService.ts` — `SyncSettings` に `reservationBlockThreshold?: number` 追加。
2. `src/stores/settingsStore.ts` — フィールド + setter 追加。デフォルト 2。**persist しない**（Firestore 同期、`lateBalanceMode` と同じ扱い）。
3. `src/services/sessionMutations.ts` — `setReservationBlockThreshold`（`computeSetSetting` 利用）。
4. `src/hooks/useSessionWriter.ts` — `setReservationBlockThreshold` writer。
5. `src/hooks/useFirebaseSync.ts` — remote → store ミラー（`lateBalanceMode` と同パターン）。
6. `src/lib/algorithm.ts` —
   - `assignCourts` options に `reservationBlockThreshold?: number`。
   - 中央値計算 + `isReservationBlocked(playerIds)` ヘルパー。
   - ダブルス / シングルス両方の予約ループで、全員待機チェックの直後に `if (isReservationBlocked(...)) continue;`。
7. `src/lib/gameOperations.ts` — `computeFinishAndContinue` options に追加し `assignCourts` へ伝播。
8. `src/services/sessionMutations.ts`（`finishMatchAndContinue`）— `remoteSettings.reservationBlockThreshold` を読んで渡す。
9. `src/pages/MainPage.tsx` — store の値を `assignCourts` へ渡す。
10. `src/pages/SettingsPage.tsx` — +1 / +2 / +3 の選択 UI。
11. テスト — ブロック判定（中央値+閾値）、`computeSetSetting`、sync ミラー。

## 挙動メモ

- 保留された予約のメンバーは未消化 pending に含まれるため、`normalCandidates` からも除外される（`algorithm.ts:1096-1105`）。よって超過メンバーは予約・通常どちらでも今回は配置されない＝「全然入れない」。共メンバーも一緒に待つ（= 予約全体を保留）。
- 全員 `gamesPlayed=0`（序盤）は median=0, gap=0 < 閾値 でブロックされない。
- 旧セッション等で `reservationBlockThreshold` 未設定なら デフォルト 2 を適用。
