# 用語整理: 「序列」を外部境界から追放する（レーティング反転バグの再発防止）

2026-07-29

## 背景・課題

自動セッション作成で序列（`buildInitialOrder` が作る内部の並び順）が丸ごと
反転していたバグを修正した（`rating = 1000 - ordering` → `rating = ordering`）。
その root cause はコードのロジックではなく **用語の混線** だった。

このアプリには正しく2層の概念がある。

- **レーティング**（`Player.rating`）: 外から入る実力スコア。デフォルト
  1500。**大きいほど強い**。
- **序列**: `buildInitialOrder` がレーティングから作る **内部の並び順**。
  **index 0 が最強**。並べ替え済みリストの位置であり、外部から渡す値では
  ない。

## 混線がどこで起きたか

1. GAS（`docs/webhook.js`）が Players シート D 列 = **skill**（大きいほど
   強いレーティングスコア）を読み、コメントで「skill を序列として使用」と
   書き、tmp シートの列名・レスポンスのキー名を `ordering` にした。
2. アプリ（`scripts/auto-create-session.ts`）がワイヤ上のフィールド名
   `ordering` を見て「1が最強の順位」（＝上記の「序列」の意味）と解釈し、
   `rating = 1000 - ordering` で変換した。

実体は最初から skill（レーティング）スコアで、変わったのは呼び名だけ
だった。GAS 側のコメントが「序列として使用」と書いたことで、本来
「レーティング」であるはずの値が、アプリ側の実装者には「（index 0 が最強の）
序列そのもの」に見えてしまい、向きを反転させる変換が「正しい」ものとして
実装されてしまった。

## なぜ長期間気づかれなかったか

- `doc/02_functional_requirements.md` に明記されている通り、
  「レーティングは画面上に一切表示しない（心理的安全性のため）」という
  設計方針があり、rating の実値やそこから作られる序列を UI 上で
  目視確認する手段が無かった。
- 実力差の指標が、順序の反転に対して **厳密に対称** だった。
  `getSkillGapPenalty` が見る順位差 `|i − j|` も、`hasTopBottomExtremes`
  が見る「上位帯と下位帯の同居」も、順序をひっくり返すと上位帯と下位帯が
  入れ替わるだけで値は変わらない。実際、実データ（13人29試合）を意図どおりの
  序列と反転した序列の両方で測ったところ、上位3×下位3 の同居率は
  **どちらも完全に同じ 31.0%** だった。つまりシミュレーションでも実データでも、
  この不具合は指標上に一切現れない。

  反転が実際に影響するのは非対称な処理だけで、確実なのは `applyStreakSwaps`
  （勝てば index を上へ・負ければ下へ）。反転下では勝った人が実際には
  弱い側へ動かされていた。

**表示されず、指標にも現れない**という二重の不可視性が原因で、
運営者から生の skill 値と「最弱のメンバーに 1 を割り当てた」という
運用上の意図を聞いて初めて発覚した。

## 今回の改名内容

### `scripts/auto-create-session.ts`

- `MemberData.ordering` → `skill`
- `orderingToRating` → `skillToRating`（コメントも新しい用語に更新。
  経緯の記述は活かした）
- `readTmpSheet` のレスポンス型に `skill` を追加し、`p.skill ?? p.ordering`
  で読む
- `createTmpSheet` の `missingOrdering` は `data.missingSkill ?? data.missingOrdering`
  で読む
- `checkPlayerIssues` の issue 理由 `'序列未設定'` → `'レーティング未設定'`
  （Discord 通知にそのまま出る文言。他の同一文言・関連コメントも
  「外部入力」を指しているものは同様に修正した）
- ログ・コメント中の「序列」のうち **外部入力を指しているもの** のみ
  「レーティング」に修正した。`AUTO_SESSION_ADMINS` の並び順（配列内での
  優先順位）を指す「序列」など、**内部の並び順を指す既存の用法はそのまま
  残した**（今回の問題はあくまで外部境界での混線であり、内部の「序列」と
  いう語自体は元々正しい用法）。

### `docs/webhook.js`

- `getDefaultOrderingMap_` → `getDefaultSkillMap_`
- コメントを「skill はレーティング（大きいほど強い）であり、順位ではない」
  と明記する内容に書き換え、反転バグの原因だったことも記録した。
- 新規 tmp シート作成時のヘッダ行を `['eventId', 'name', 'gender', 'ordering']`
  → `['eventId', 'name', 'gender', 'skill']` に変更。既存シートの読み取りは
  位置ベース（`data[i][3]`）なので、ヘッダの改名で既存シートが壊れることは
  ない（コメントに明記）。
- `readTmpSheet_` の返却に `skill` を追加（`ordering` も同じ値で残す）。
- `createOrUpdateTmpSheet_` の内部変数 `missingOrdering` → `missingSkill`
  に改名。返却オブジェクトは `missingSkill` と `missingOrdering`
  （後方互換用、同じ値）の両方を持つ。
- 他のコメント中の「序列」も、外部入力（tmp シートのレーティング値）を
  指しているものはレーティングに修正した。

## 後方互換（デプロイの結合）について

`docs/webhook.js` は clasp（`rootDir: ./docs`）で Google Apps Script へ
**手動デプロイ**される。リポジトリを直しても、管理者が `clasp push` する
までは本番の GAS は旧コード（`ordering` のみを返す）のままである。一方
`scripts/auto-create-session.ts` は GitHub Actions で **毎朝 6:00 JST に
自動実行** される。

このため、アプリ側がワイヤ上のフィールド名を新名称 `skill` だけ受け付ける
実装にすると、`clasp push` が完了するまでの間、全参加者が「レーティング
未設定」扱いになりセッション作成が止まってしまう。

これを避けるため、境界を越える2つのフィールドはどちらも **新旧両対応**
にした。

- `readTmpSheet` レスポンスの `participants[].skill` / `.ordering`
  → アプリは `p.skill ?? p.ordering` で読む。GAS は新旧両方のキーを
  同じ値で返す。
- `createOrUpdateTmpSheet` レスポンスの `missingSkill` / `missingOrdering`
  → アプリは `data.missingSkill ?? data.missingOrdering` で読む。GAS は
  新旧両方のキーを同じ値で返す。

この対応により、`clasp push` の前後どちらでもアプリは正常に動作する。
後方互換コード（`?? ` フォールバックと GAS 側の旧キー出力）は
`clasp push` 完了を確認した後、任意のタイミングで削除してよい
（今回は削除しない）。

## 管理者がやること

**`docs/webhook.js` の変更を反映するには `clasp push` が必要。**
このリポジトリの変更だけでは本番の GAS Web App には反映されない。
`clasp push` 実施後、tmp シート新規作成時のヘッダ列名が `skill` に
変わる（既存の tmp シートは列名を変更しないので影響なし）。

## 完了条件

- `npm run build` / `npm run lint` / `npm run test:run` が通ること
- 既存テストの `ordering:` を新名称 `skill:` に更新済み
- 後方互換の単体テスト（`readTmpSheet` が旧キー `ordering` のみ / 新キー
  `skill` のみ / 両方の各ケースで正しく `skill` を読めること）を追加済み
- 機能・`rating` の計算結果は変更していない（純粋な改名 + 後方互換の追加）
