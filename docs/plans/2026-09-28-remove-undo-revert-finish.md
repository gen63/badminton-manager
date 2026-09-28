# アンドゥ/リドゥ撤廃 ＋ 履歴画面「コートに戻す」（試合終了の取り消し）

## Context
- 現行アンドゥ/リドゥ（`undoStore` → `overwriteGameState` で `gameState` を丸ごと上書き）は
  使うたびに `pairPreferences` と未撮影の同期設定（`genderBalanceMode` / `lateBalanceMode` /
  `forceBulkAssignment` / `lateBalanceAutoFired` 等）を消し、他端末の新しい変更も上書きする。
  記録は「試合終了」「コートクリア」の2操作のみで、テストも無い → **撤廃**。
- 一方「試合終了の押し間違い」は既存の多層ガード（権限・20秒ロック・600ms長押し・4:30以内確認）
  をすり抜けて残っている。撤廃で失う「取り消す」の代替として、**履歴画面から、終了2分以内の試合を
  コートに戻す**専用操作を追加する。全体上書きではなく transaction 内で関係箇所だけを戻す。
- ユーザー決定: 猶予 **2分** / 権限は **終了ボタンと同じ**（`canFinishGame`）/ 表示は **履歴画面のみ**。
- 連続モードでは終了と同時に次の組が**配置＋開始**される（`gameOperations.ts:380-396`、
  `isPlaying:true`）。2分以内ならその次の組を取り消して待機に戻したうえで元の試合を戻す。

## Part 1: アンドゥ/リドゥ撤廃
- 削除: `src/stores/undoStore.ts`, `src/types/undo.ts`,
  `overwriteGameState`（`src/services/sessionMutations.ts:107-132`、他に呼び出しが無いことを確認して削除）
- `src/pages/MainPage.tsx`: `Undo2/Redo2` import・`useUndoStore`・Ctrl+Z/Y の useEffect・
  `pushUndo()`（clearCourt / executeFinishGame）・`handleUndo/handleRedo`・ヘッダのボタン・
  終了トーストの `{ label: '取り消す' }` action を削除。`FINISH_UNDO_TOAST_MS` は用途に合わせ改名/整理。
  終了トースト文言に「間違えたら履歴から2分以内に戻せます」を添える。
- `SettingsPage.tsx` / `SessionCreate.tsx` / `SessionJoinPage.tsx` の `clearAll` 呼び出し削除。
- `Toast` / `useToast` の `ToastAction` は他に使用箇所があれば残し、無ければ削除。
- `README.md` の Undo/Redo 記載削除。`docs/plans/INDEX.md` の `2026-02-10-undo-match-end.md`
  行に「（2026-09-28 撤廃）」を追記。

## Part 2: 「コートに戻す」
### データ: 終了時に復元情報を Match に残す
`src/types/match.ts` に optional フィールド追加（旧データは無し＝戻せない扱い）:
```ts
finishRevert?: {
  playersBefore: { id: string; isResting: boolean; forcedRestAt?: number }[]; // 出場4人の終了前
  court: { assignedAt?: number; startPressedAt?: number; restingPlayerIds?: string[] };
  fulfilledReservationIds: string[];      // 終了時＋連続配置で fulfilled にした予約
  nextStartedAt?: number;                 // 連続配置で開始した次の試合の startedAt
  nextActivatedFromRestIds?: string[];    // 次の組で休憩から呼び出した人
}
```
- `computeFinishAndContinue`（`src/lib/gameOperations.ts` ~203-450）でこれを埋める。
- GAS/レーティング送信など Match を外部へ出す箇所があれば `finishRevert` を除外する（grep で確認）。

### 純粋関数 `computeRevertFinish(state, matchId, now)`（`gameOperations.ts`）
戻り値 `{ newState } | { error: 'not_found'|'expired'|'no_revert_info'|'court_busy'|'player_elsewhere'|'not_latest' }`
- 条件: `finishRevert` あり / `now - finishedAt <= 2分`（定数 `FINISH_REVERT_WINDOW_MS`）/
  そのコートの最新の試合 / コートが「空」または「`isPlaying && startedAt === nextStartedAt`（連続配置の次の組）」/
  元の4人が（そのコートの次の組を除き）他コートにいない。
- 処理:
  1. `matchHistory` から削除 → 既存 `recomputePlayerMatchStats`（`sessionMutations.ts:684`）で
     gamesPlayed/lastPlayedAt 再計算（`computeRemoveMatch` と同様。必要なら gameOperations 側へ移設/再利用）
  2. 次の組があれば外す（コートを空に）＋ `nextActivatedFromRestIds` を `isResting:true` に戻す
  3. `fulfilledReservationIds` の予約を `pending` / `fulfilledAt:0` に戻す
  4. 元4人の `isResting` / `forcedRestAt` を `playersBefore` に戻す
  5. コートに teamA/B・`isPlaying:true`・`startedAt=match.startedAt`・`finishedAt:0`・scores 0・
     `court` の assignedAt/startPressedAt/restingPlayerIds を復元
- 練習終了間際に自動 OFF になった連続モード等の設定は戻さない。

### ラッパー `revertMatchFinish(sessionId, matchId)`（`sessionMutations.ts`）
`finishMatchAndContinue` と同じ `runTransaction` パターン（remote を read → compute → update、
`aborted`→`SessionError('conflict')`）。エラーコードは結果として返す。`useSessionWriter` 経由で公開。

### 権限: 予測をフック化
`MainPage.tsx:574` の `nextMatchPrediction` useMemo（と `pastLastCall` 算出）を
`src/hooks/useNextMatchPrediction.ts` に切り出し、MainPage と HistoryPage で共用。
HistoryPage で `canFinishGame({ isAdmin, certainIds, myPlayerId })`（`src/lib/finishOperationGuide.ts:203`）を使う。

### UI（`src/pages/HistoryPage.tsx`）
- 試合カードに、戻せる条件（2分以内・`finishRevert` あり・権限あり）のとき「コートに戻す（残り m:ss）」ボタン。
  期限で消えるよう setTimeout 1本で再描画（毎秒 tick は残り表示のみ、カード単位）。
- 確認ダイアログ: コート番号・両チーム名。次の組がいる場合「○○・○○ vs ○○・○○ の試合は取り消されます」。
  結果入力済みなら「入力した結果は消えます」。
- 失敗時トーストで理由（期限切れ／次の試合が進んでいる／メンバーが別コートにいる）。成功時「○コートに戻しました」。
- DESIGN.md のボタン/ダイアログ規約に従う。

## 実装体制
- Part 1 → Part 2 の順に、それぞれ Sonnet サブエージェントへ委任（Part 2 はテスト込み）。
  私はレビュー・受け入れ・チェック実行・commit/push。
- plan を `docs/plans/2026-09-28-remove-undo-revert-finish.md` にコミットし INDEX.md に1行追記。
- ブランチ: `claude/badminton-manager-undo-redo-e2c1r2`（PR はユーザー指示があれば作成）。

## 検証
- `npm run build` / `npm run lint` / `npm run test:run` 全通過。
- 追加テスト（`src/lib/gameOperations.test.ts`）: 通常モードで戻す / 連続モードで次の組を取り消して戻す /
  予約 fulfilled の復元 / 休憩フラグ（restReturn・強制休憩・休憩から呼び出し）の復元 / 2分超過 /
  次の組が進んでいる（startedAt 不一致・空でない）/ 元メンバーが他コート / 最新でない試合 /
  `pairPreferences`・設定が不変であること。
- `sessionMutations.test.ts`: ラッパーが remote state に対して update すること、エラー結果の返却。
- `grep -r "undo\|Undo" src` で残骸が無いこと。
