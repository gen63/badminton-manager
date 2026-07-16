# オート作成セッションの tmp_MMDD シート自動掃除

## 背景・課題

`scripts/auto-create-session.ts` は毎日 06:00 JST に GitHub Actions で実行され、
対象日の参加者・序列データを GAS 経由で Google スプレッドシートの
`tmp_MMDD` シート（`createOrUpdateTmpSheet_`）に書き出す。

このシートは**練習日ごとに 1 枚ずつ増え続け、削除されない**ため、
スプレッドシートのタブがどんどん増えて使いにくくなっていた。

tmp シートの序列/性別はセッション作成時に Firestore へ読み込まれるので、
**イベントが過去になった tmp シートは破棄しても問題ない**（永続先は
Players シートのデフォルト序列と、作成済みセッション自体）。

## 方針（決定済み）

**過去日を自動削除**: 新しい tmp シート作成/更新のたびに、GAS 側で
日付が「今日(JST)」より前の `tmp_MMDD` シートを自動削除する。

- 当日・未来の予定シートは残す → 保留中（序列未入力・手動リラン待ち）の
  入力が消えない。
- 完全自動でメンテ不要。手動操作やメニュー追加は行わない。

## 実装

### GAS 側 (`docs/webhook.js`)

新規ヘルパー `cleanupOldTmpSheets_(ss, keepSheetName)`:

1. JST の「今日」を 0 時基準の `Date` として求める。
2. 全シートを走査し、名前が `/^tmp_(\d{2})(\d{2})$/` のものを対象にする。
3. MMDD に年が無いため、今日に最も近い年を推定（候補が今日から
   ±180 日を超える場合は年を ±1 補正）。
4. 推定日付が今日より**厳密に前**なら `deleteSheet` で削除。
5. 今作成/更新したシート (`keepSheetName`) は名前一致で必ず除外
   （当日・未来なので通常も残るが二重の安全策）。
6. 削除したシート名配列を返す。

`createOrUpdateTmpSheet_` の末尾で cleanup を呼び、戻り値の `result` と
`doPost` のレスポンス JSON に `deleted`（削除シート名配列）を追加する。

- `ss.getSheets()` の結果を配列で確保してから削除するため、
  反復中の削除でインデックスがずれない。
- 非 tmp シート（当日結果・Players 等）が常にあるため、
  「最後の 1 枚は消せない」制約には抵触しない。

### スクリプト側 (`scripts/auto-create-session.ts`)

`createTmpSheet` のレスポンス型に `deleted?: string[]` を追加し、
削除件数・シート名をログ出力するのみ（挙動は GAS 側で完結）。

## テスト

- tmp シート掃除の本体は GAS（`docs/webhook.js`）にあり、既存の GAS 関数
  （`cleanupResultsDuplicates` 等）同様に本リポジトリのユニットテスト対象外。
- スクリプト側の変更はログ出力のみで純粋関数の増減が無いため、
  既存テストが壊れないことを `npm run build` / `npm run lint` /
  `npm run test:run` で確認する。

## 受け入れ確認

- `npm run build` / `npm run lint` / `npm run test:run` が通ること。
- 既存テストが壊れないこと。
