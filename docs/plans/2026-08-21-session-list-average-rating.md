# セッション一覧の金額表示を平均レートに差し替え（開発モード限定）

2026-08-21

## 背景 / 目的

セッション選択画面のカード1行目には、開発モード限定で収入合計（`💵10,200`）が
出ていた。金額は会計ページで確認できるうえ、一覧を見て知りたいのは
「その開催がどういう面子だったか / どういう面子になるか」であって金額ではない。
1行目は `flex-nowrap` で既に横幅が限界（体育館名が truncate され始めている）ため、
枠を増やさず**金額チップを平均レートチップに置き換える**。

平均レートが出ると、

- 開催ごとのメンバー層（強い日 / ゆるい日）を人数によらず比較できる
- 開催前でも当日の面子の層が分かる（レート同期の結果確認も兼ねる）

開発モード限定の運用者向け情報なので、一般参加者の画面は変わらない。

## 表示仕様

### 対象のレート

`Player.rating` = **名簿の初期レート**（tmp シートの `skill` 由来で人が付けた序列決定用の
値）。その日の勝敗から解く `performanceRating`（パフォーマンスレート）ではない。

### 統計量

**平均**（中央値ではなく）。レートは Elo 系の間隔量として扱われており
（`performanceRating` の「相手平均 / 味方平均」も平均）、面子の層を1つの数字で
表すなら平均が素直。2行目の試合数チップが既に「中央」なので、同じラベルが
並んで意味を取り違えるのも避けられる。

### 母集団

**名簿上の全プレイヤーのうち `rating > 0` の人**。

- 試合数で絞らない。開催前（全員 `gamesPlayed = 0`）でも面子の層を見たいため。
  実績サマリである `medianGamesPlayed`（`gamesPlayed > 0` 限定）とは目的が違うので
  母集団は統一しない。
- 未レート（`rating` 未設定 or 0）は除外する。0 は「レート0の弱い人」ではなく
  「実力不明」を表す値で、`buildInitialOrder` も 0 を数値として使わず序列の中位へ
  挿入している。母集団に入れると平均が実態より大きく下振れする。

該当0人（全員未レート）なら `undefined` とし、非表示。

### 数値の書式

小数第1位で丸める（`summarizeSessionMedians` と同じ丸め）。レートの絶対値の
スケールは運用側の入力次第（tmp シートの `skill`）なので、桁を仮定した整数丸めは
しない。

### 配置

金額チップと同じ位置（1行目の末尾）。ラベルは `平均`、アイコンは lucide の
`Gauge`。試合数（`32試合`）と誤読されないようラベルを付け、Trophy は使わない。

```
[複] 8/21(木) 14名 千川館 32試合 ⏲平均1520.5   ← 1行目（💵 の枠を置き換え）
中央 4.5  📄 入りやすい人が表示される配置予測…   ← 2行目（変更なし）
```

## 実装方針

### 1. `src/lib/ratingSummary.ts`（新規）

```ts
/** rating > 0 のプレイヤーの平均レート（小数第1位で丸め）。該当0人なら undefined */
export function averagePlayerRating(players: Player[]): number | undefined
```

### 2. `src/types/session.ts`

派生フィールド `incomeTotal?: number` を削除し、`averageRating?: number` を追加する。

### 3. `src/services/sessionService.ts`

`docToSession` で `averagePlayerRating(gameState?.players ?? [])` を詰める
（`gameState.players` は同一ドキュメント内にあるので追加読み込みは発生しない）。

一覧専用だった `computeDerivedIncomeTotal` は参照が無くなるので関数ごと削除し、
`src/services/sessionService.test.ts`（この関数だけのテストファイル）も削除する。
会計ページ側の計算（`accountingCalc.ts` の `incomeTotal`）と GAS アップロードは
別物なので**変更しない**。

### 4. `src/pages/SessionSelectPage.tsx`

1行目の `💵 incomeTotal` チップを `Gauge 平均{averageRating}` チップへ置き換え。
`devMode` 限定なのは従来どおり。

## テスト

`src/lib/ratingSummary.test.ts` を新規追加:

- 平均が出ること / 未レート（未設定・0）が除外されること
- `gamesPlayed = 0` でも母集団に含まれること
- 割り切れないときに小数第1位へ丸まること
- レート登録済み0人・空配列で `undefined`

## 非対象

- 一般ユーザー（非開発モード）への表示
- 会計ページ・GAS アップロードの金額計算
- フィルタサマリ（`N開催・中央 X`）へのレート追加
