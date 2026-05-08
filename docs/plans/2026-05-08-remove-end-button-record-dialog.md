# 終了直後の勝者選択モーダル撤去

## 背景

勝敗記録モード (`recordScores=true`) でコート上の試合「終了」ボタンを押すと、
押したユーザーの画面にだけ即座に `WinnerSelectModal` (勝者選択ダイアログ) が
表示される仕様だった。これは `MainPage.tsx` の `pendingScoreMatch` ステートで
制御される「終了直後フロー」。

一方で、参加メンバー全員には `UnrecordedMatchPrompt` が
未記録試合 (`scoreA===0 && scoreB===0 && !winner` かつ自分が参加者) を
自動検出し、同じ `WinnerSelectModal` を順次表示する仕組みが存在する。

ユーザー要望:
> 勝敗記録モードにおける、終了ボタン押下後の記録ダイアログの表示をやめたい。
> 各メンバーへの、未記録試合のダイアログ表示で十分な認識

→「終了直後フロー」を撤去し、入力導線は `UnrecordedMatchPrompt` 一本に統一した。

## 影響

- 勝敗記録モード ON で「終了」を押しても、押した本人だけに即座にダイアログが
  出る挙動は無くなる。
- 参加メンバー全員には従来どおり `UnrecordedMatchPrompt` 経由でモーダルが
  表示される（終了ボタンを押した本人も参加者なら自動的に表示される）。
- 観戦者・管理者など試合に参加していない人が「終了」を押した場合、
  ダイアログは出ない（要望どおりの挙動）。

## 変更内容

### `src/pages/MainPage.tsx`
- `WinnerSelectModal` / `useUnrecordedDismissStore` の import を削除。
- `pendingScoreMatch` ステートを削除。
- 終了ボタン handler から `teamASnapshot` / `teamBSnapshot` 退避と
  `if (recordScores) setPendingScoreMatch(...)` ブロックを削除。
- `recordScores` セレクタはこのファイル内で参照が無くなったので削除。
- 終了直後の `WinnerSelectModal` 描画ブロックを丸ごと削除。
- `<UnrecordedMatchPrompt enabled={pendingScoreMatch === null} />` を
  `<UnrecordedMatchPrompt />` に変更。

### `src/components/UnrecordedMatchPrompt.tsx`
- `interface Props { enabled: boolean }` を削除し、引数なしコンポーネントに
  変更。
- `canShow` 計算から `enabled &&` を削除。

### `src/stores/unrecordedDismissStore.ts`
- 終了直後フローの dismiss を説明していた JSDoc 一節を削除（機能撤去のため）。
  ストア自体は `UnrecordedMatchPrompt` のスヌーズ機構として継続使用。

## 検証

- `npm run build` / `npm run lint` / `npm run test:run` を通過。
- 手動: 勝敗記録モード ON で終了 → 即時モーダル無し、`UnrecordedMatchPrompt`
  が参加者にだけ後追いで表示。OFF では何も出ない。
