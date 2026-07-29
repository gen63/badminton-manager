# 履歴画面: 絞り込み中メンバーの名前を強調表示

## 背景 / 課題

`HistoryPage` はメンバー名で試合を絞り込める（URL クエリ `?player=名前`）。
しかし試合カード（`MatchCard`）はチームのメンバー名を
`sortPairForDisplay(...).map(getPlayerName).join(' ')` で **1本の文字列** に連結して
表示しているため、絞り込み対象のメンバーが

- そのカードのどちら側（勝ち側 / 負け側）にいるのか
- ペアのどちらなのか

を目で追う必要がある。カードが縦に並ぶと特に読み取りづらい。

## 目的

絞り込み中のメンバー名を、試合カード内で視覚的に一目で識別できるようにする。

## 方針

`MatchCard` に `highlightName?: string | null` を追加し、名前を **1人ずつ span で
描画** して、`getPlayerName(id) === highlightName` の span にだけ強調スタイルを当てる。

### 表示上の制約と選んだスタイル

現状のカードは「勝ち側を左・負け側を右」に置き、既に次の差を付けている:

- 左（勝ち側）: `font-bold text-foreground`
- 右（負け側）: `text-muted-foreground`

このため **太字だけでは左側で差が出ない**。左右どちらでも効く指標として
**色（indigo）+ 太字** を使う:

- 強調時: `font-bold text-indigo-600`
- 非強調時: 現行のまま（左 `font-bold text-foreground` / 右 `text-muted-foreground`）

indigo は本画面で既に「選択中」を表す色（フィルタボタン `#e0e7ff` / `#3730a3`、
強さランキングの選択行 `bg-indigo-50 border-indigo-300`）として使われており、
「いま選んでいる人」という意味づけと一致する。

### 実装詳細

1. `MatchCard` の props に `highlightName: string | null` を追加。
2. `leftNames` / `rightNames`（文字列）を廃止し、表示対象の **ID 配列** を作る
   （シングルスは 1 要素、ダブルスは `sortPairForDisplay` 済みの 2 要素）。
3. 各 ID を `<span>` で描画し、区切りは半角スペース（現行 `join(' ')` と同じ見た目）。
   `truncate` を効かせるため、外側の `span` は現状のクラスを維持し、内側の
   個別 `span` にだけ強調クラスを付ける。
4. 強調された名前には `aria-label`（例: `絞り込み中のメンバー`）ではなく、
   スクリーンリーダー向けに視覚以外の手掛かりが必要ないため追加しない
   （フィルタ状態は既に成績サマリで文言として提示済み）。
5. `MatchList` は `highlightName` をそのまま各 `MatchCard` へ渡す。
6. `HistoryPage` は `filterActive ? filterPlayerName : null` を `MatchList` に渡す。
   （絞り込み解除時は強調しない）

## 変更ファイル

- `src/pages/HistoryPage.tsx` のみ

## 非対象

- 名前の一致は既存のフィルタと同じく **表示名の完全一致**（`matchFilter.ts` と同じ規則）。
  同名メンバーの区別は元々できないため、本変更でも対応しない。
- スコア・時刻など名前以外の要素の強調は行わない。

## 検証

- `npm run build` / `npm run lint` / `npm run test:run`
- 手動: 履歴画面でメンバーを選択し、
  - 勝ち側にいる試合 / 負け側にいる試合の双方で当人の名前だけが indigo 太字になること
  - 「全員」に戻すと強調が消えること
  - 強さランキングから選択した場合も同様に反映されること
