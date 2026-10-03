# 予約の期待差ゲート（2026-10-03）

## 背景
参加者ごとに「期待試合数」と「差（実績 − 期待）」を表示している（`lib/playerStats.ts` の
`computeStayStats` / `computeExpectedGames`。滞在時間モードは滞在按分、回数平均モードは全員平均）。
予約は配置で優先されるため、期待より多く試合している人が予約で割り込める問題があった。
従来の保留判定 `reservationBlockThreshold`（在席者の試合数中央値 + 閾値）は、滞在時間モードの期待とずれる。

## 仕様（ユーザー決定）
ボーダー B = 期待差 **+1.5**（差を小数1桁に丸めた値 ≥ B で該当）。定数 `RESERVATION_EXPECTED_DIFF_LIMIT`
（`lib/reservationGate.ts`）で固定し、設定では変えられない。

1. **予約追加時（UI）** `ReservationAddModal` / `PlayerPickList`（`showGameStats` の予約追加のみ）
   - 作成者（`isCreator()`、開発モード含む）以外は差 ≥ B のメンバーを選べない（グレー・タップ不可）。
     行に「期待差+1.5以上のため予約不可」。
   - 作成者は選択可。行に「期待差+1.5以上（保留されます）」。
   - 期待が算出できない人（null）は制限しない。
2. **割り振り時の保留（algorithm）**: 「中央値 + 閾値」を「期待差 ≥ B」に置換。メンバーの誰かが差 ≥ B の間は
   予約は保留（pending のまま）、B 未満になれば通常どおり優先配置。
   期待は表示と同じ定義・同じ母集団（セッションの全 players、now = `Date.now()`）で算出。
3. **「優先」フラグ**: `Reservation.forcePriority?: boolean`。作成者だけが予約一覧で ON/OFF できる
   （`computeSetReservationForcePriority`、`useSessionWriter.setReservationForcePriority`）。
   `forcePriority=true` の予約は期待差による保留をスキップし従来どおり優先配置。
   作成者が差 ≥ B のメンバーを含めて追加した場合も初期値は false（一覧で後から ON）。
4. **予約一覧の判別**（`ReservationPage`）: 保留される pending 予約に amber の「保留中: げん 期待差+1.8」
   バッジ、該当メンバーのチップを amber 表示。`forcePriority=true` は「優先」バッジのみで保留表示なし。
   判定は割り振りと同じ `isReservationHeldByExpectedDiff`、期待は `usePlayerGameStats`（画面を開いた時点の now 固定）。
5. **設定「予約の試合数制限」は撤去**（SettingsPage の UI、settingsStore、`setReservationBlockThreshold`、
   useFirebaseSync の同期、`SyncSettings` / `NEW_SESSION_DEFAULTS` の項目）。

## 変更点
- `lib/stayStart.ts` 新設: `resolveStayStart` を `algorithm.ts` から移動。`algorithm` と `playerStats` の両方が
  ここから import（`playerStats → algorithm` の循環を解消。`algorithm → reservationGate → playerStats → stayStart`）。
- `lib/reservationGate.ts` 新設: ボーダー定数、`isOverExpectedDiff`、`computeExpectedDiffById`、
  `overExpectedMemberIds` / `hasOverExpectedMember`、`isReservationHeldByExpectedDiff`、`getReservationPickState`（UI 分岐）。
- 判定を置き換えた箇所（algorithm.ts）: `getCallableReservationRestingIds`、`assignCourts` 本体の `isReservationBlocked`
  （シングルス予約・ダブルス予約の2箇所）、`computeAffinityPairs` の公平性ガード（pairPreference.ts。引数を `expectedDiffById` へ）。
- `assignCourts` / `getCallableReservationRestingIds` の options に `practiceEndTime` / `sessionPlayers`（母集団）を追加。
  呼び出し元（MainPage、nextMatchPrediction + useNextMatchPrediction、gameOperations + sessionMutations）から渡す。
  未指定時は allPlayers + restingPlayers（または presentPlayers）にフォールバック。

## 互換性
- Firestore に残る旧 `settings.reservationBlockThreshold` は読まずに無視する。
- `forcePriority` 未設定の既存予約は false 扱い（保留される）。
- 滞在時間モードで会費・名簿が未完了の人は期待 null のため保留対象外。
