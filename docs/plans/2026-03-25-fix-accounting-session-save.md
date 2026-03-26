# 会計画面の練習種別がセッションに保存されないバグの修正

## 日付: 2026-03-25

## 問題

会計画面で練習種別（複/単/楽）を変更した後、プレイヤーの支払いデータが更新されると、練習種別が変更前の値に戻ってしまうことがある。

## 根本原因

`AccountingPage.tsx` の自動同期useEffect（プレイヤー支払いデータからカウントを同期する処理）がstale closure問題を抱えていた。

- `saveAllInputs` 関数はクロージャ経由でReact state（practiceType等）を参照
- 自動同期useEffectの依存配列は `[players, initialized]` のみ
- practiceType変更後にplayers変更があると、古いクロージャのpracticeTypeで `saveAllInputs` が呼ばれ、変更が上書きされる

## 修正

自動同期useEffect内で `saveAllInputs` を使わず、`useAccountingStore.getState().lastInput` から最新の永続化済み値を直接読み取り、変更されたカウント系フィールドのみをマージして保存するようにした。

## 修正ファイル

- `src/pages/AccountingPage.tsx` — 自動同期useEffect内のsave処理
