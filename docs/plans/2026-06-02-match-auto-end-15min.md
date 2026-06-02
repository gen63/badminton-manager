# 15分超過試合の自動終了

2026-06-02

## 背景 / 要望

- 15 分を超える試合は自動で終了してほしい。
- 仮に連続モード（`continuousMatchMode`）が ON でも、自動終了した試合のコートには
  **次の試合を自動で配置しないでほしい**（空コートのまま手動配置に委ねる）。

## 現状把握

- 試合終了は `finishMatchAndContinue`（`src/services/sessionMutations.ts`）が
  `runTransaction` 内で `computeFinishAndContinue`（`src/lib/gameOperations.ts`）を
  適用する。連続モード ON のときは同関数内で `assignCourts` を呼び、終了直後に
  同コートへ次の試合を自動配置している（`isPlaying=true` + 新 `startedAt`）。
- 終了処理は `matchStartedAt`（= `court.startedAt`）をべき等キーにしており、
  複数端末が同時に終了 transaction を投げても 1 つだけ成功し、他は
  `already_finished` を返す。→ 自動終了を全端末で走らせても安全。
- 経過時間は `court.startedAt`（ms）から算出。既存の 90 分自動オン
  （`MainPage.tsx` の `lateBalanceAutoFired`）が `setTimeout` で実装されている。

## 設計

### 1. 連続配置をスキップするフラグを追加

- `computeFinishAndContinue` の options に `skipContinuous?: boolean` を追加。
  連続配置ブロックの条件を
  `if (options.continuousMatchMode && !options.skipContinuous)` に変更する。
  `skipContinuous=true` のときは `continuousMatchMode` 設定自体は変えず、
  この 1 回の自動配置だけを抑止する（通常の手動終了は従来通り連続配置する）。
- `FinishGameOptions`（`sessionMutations.ts`）にも `skipContinuous?: boolean` を
  追加し、`computeFinishAndContinue` へ素通しする。

### 2. 15 分到達で自動終了するタイマー（MainPage）

- 定数 `MATCH_AUTO_END_MS = 15 * 60 * 1000` を `gameOperations.ts` に追加・export。
- `MainPage` に `autoEndMatch(courtId, matchStartedAt)` を `useCallback` で追加。
  `finishMatchAndContinue(..., { skipContinuous: true })` を呼び、`result==='success'`
  のときだけ「15分を超えたためコート◯の試合を自動終了しました」を toast。
  `already_finished`（他端末が先に処理）や例外時は静かに無視。
- プレイ中コートごとに `setTimeout` を `startedAt + 15分 - now` で仕掛ける
  `useEffect` を追加（90 分自動オンと同型）。既に超過していれば即発火。
  依存はプレイ中コートの `(id, startedAt)` シグネチャにし、スコア更新などでの
  不要な再スケジュールを避ける。

## スコープ外

- 15 分という閾値の設定 UI 化（今回は固定値）。
- 自動終了した試合の Undo（自動発火のため Undo スタックは積まない）。

## 確認

- `npm run build` / `npm run lint` / `npm run test:run`
- 既存テスト `src/lib/gameOperations.test.ts` に `skipContinuous` のケースを追加。
