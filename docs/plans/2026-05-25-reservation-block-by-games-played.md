# 予約と休憩の連動・試合数による予約制限

2026-05-25（改訂: rest 連動方式へ方針転換）

## 背景 / 経緯

当初「予約メンバーが完全優先で割り込む」挙動を見直すため、`assignCourts` で
「予約メンバーの試合数が中央値+閾値以上なら予約を保留」するカウント制限を入れた
（コミット 75a68d7）。しかし議論の中で以下が判明:

- 旧来「予約中の人は通常配置から除外（待機）」ロジック（algorithm.ts:1129-1138）
  と組み合わさると、保留時に共メンバーまで idle になり、最悪デッドロックする。
- 本質的な用途は「ペア練習したい人が指定の組み合わせで試合する」こと。

→ 方針転換: **予約に入れたら休憩(rest)にする**。休憩は元々自動配置の対象外なので、
旧来の除外ロジックを休憩に一本化できる。予約が成立したら休憩中でも呼び出す。

## 確定仕様（ユーザー合意済み）

1. **予約にメンバー追加 → そのメンバーを休憩化**（自動）。プレイ中の人は試合後に休憩へ。
2. **予約削除 → 自動休憩したメンバーを待機へ戻す**（他に未成立予約が無い場合のみ）。
3. **予約配置は休憩中メンバーも探索対象**。成立時に `isResting=false` で出場。
4. **試合後は待機(active)に戻す**。ただし他に未成立予約があれば休憩のまま。
   - 既存の `court.restingPlayerIds`→休憩復帰は **手動 swap 用に温存**。予約経由の出場は
     この `restingPlayerIds` に積まず、新ルール（下記 finish step2）で処理する。
5. **旧「予約者を通常配置から除外」ロジック（algorithm.ts:1129-1138）は削除**（休憩が代替）。
6. **カウント制限（中央値+閾値）は維持**。試合数が多い人は予約が成立せず（休憩のまま待つ）。
   中央値は**休憩者を含む全員**で算出（全員休憩でも中央値が0に潰れないように）。

## 変更ファイル

- `src/types/court.ts`: `CourtAssignment` に `activatedFromRestIds?: string[]`（休憩から
  呼び出して出場させるメンバー。呼び出し側が `isResting=false` にする）。
- `src/lib/algorithm.ts`:
  - options に `restingPlayers?: Player[]`。
  - `reservationPool = [...activePlayers, ...restingPlayers]` で予約メンバーを探索。
  - 中央値の母集団 = `[...(allPlayers ?? activePlayers), ...restingPlayers]`。
  - 予約成立時、出場メンバーのうち休憩だった者を `assignment.activatedFromRestIds` に。
  - 旧 `reservedPlayerIds` 除外ロジックを削除。
- `src/lib/gameOperations.ts` `computeFinishAndContinue`:
  - finish step2: 試合を終えたプレイヤーのうち **未成立予約を持つ者は休憩**、それ以外は
    待機（既存の restingPlayerIds 復帰は手動 swap 用に残す）。
  - 連続配置で `restingPlayers` を渡し、`activatedFromRestIds` の isResting を false に。
- `src/services/sessionMutations.ts`:
  - `computeAddReservation`: メンバー（プレイ中でない者）を `isResting=true`。
  - `computeRemoveReservation`: 削除予約のメンバーで、他の未成立予約に無く・プレイ中でなく・
    現在休憩中の者を `isResting=false`（待機へ）。
  - `AutoAssignSpec` に `activatePlayerIds?: string[]`、`autoAssignAndFulfill` で isResting=false。
- `src/pages/MainPage.tsx` `handleAutoAssign`: `restingPlayers` を渡し、戻りの
  `activatedFromRestIds` を `activatePlayerIds` として writer へ。
- カウント制限の設定/同期（reservationBlockThreshold, SettingsPage 等）はコミット 75a68d7 のまま維持。

## 既知の制限（今回スコープ外）

- 連続モードの最小待機人数ゲート（doubles=7）は変更しない。予約メンバーが休憩に回ると
  待機人数が減り、連続自動配置が発火しにくくなる。予約は手動「配置」ボタンで確実に成立する。
  自動発火まで必要なら別 plan で対応。
