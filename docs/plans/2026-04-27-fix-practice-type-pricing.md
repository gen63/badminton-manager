# 支払い登録のデフォルト料金が練習種別を反映しない不具合の修正

## 不具合

参加者管理ページ (`PlayerSelect.tsx`) およびメインページ (`MainPage.tsx`) で
「支払」ボタンを押したときに開く `PaymentModal` の `defaultAmount` が、
**現在の練習種別 (`useSettingsStore.practiceType`) を考慮しない**。

該当コード（同一パターンが2箇所にある）:

```ts
const maleFee = session?.accounting?.maleFee || 800;
const femaleFee = session?.accounting?.femaleFee || 600;
```

`session.accounting` は **会計ページを開いて入力を行わないと undefined のまま**
であるため、`単` や `楽` セッションの開始直後に支払い登録すると、常に
`複` 用のフォールバック値 800/600 が使われてしまう。

`src/lib/accountingCalc.ts` の `PRACTICE_TYPE_OPTIONS` で正しい料金は
すでに定義されている（複: 800/600、単: 1200/800、楽: 600/400）。

## 修正方針

両ファイルで以下のロジックに置き換える:

```ts
const { practiceType } = useSettingsStore();
const practiceDefaults =
  PRACTICE_TYPE_OPTIONS.find((t) => t.value === practiceType) ?? PRACTICE_TYPE_OPTIONS[0];
const maleFee = session?.accounting?.maleFee ?? practiceDefaults.maleFee;
const femaleFee = session?.accounting?.femaleFee ?? practiceDefaults.femaleFee;
```

- 会計ページで明示的に保存された料金 (`session.accounting`) があれば優先する
  （ユーザーが手動でカスタマイズした金額を尊重）。
- なければ現在の練習種別から `PRACTICE_TYPE_OPTIONS` を引いて適用する。
- `MainPage.tsx` ではすでに `useSettingsStore` から `practiceType` を取得済みのため
  追加 import 不要。`PlayerSelect.tsx` には `useSettingsStore` と
  `PRACTICE_TYPE_OPTIONS` の import を追加する。

## 影響範囲

- `src/pages/PlayerSelect.tsx`: `maleFee`/`femaleFee` の算出ロジックのみ変更
- `src/pages/MainPage.tsx`: 同上
- `PaymentModal` 自体は変更なし（`defaultAmount` の値だけが正しくなる）

## 動作確認

- `npm run build` / `npm run lint` / `npm run test:run` がすべて通ること
- 練習種別 `単` の新規セッションで会計ページ未訪問のまま参加者管理から支払いを
  押したとき、男性 1200 / 女性 800 がデフォルトで入ること
- 練習種別 `楽` で同様に 600 / 400 がデフォルトになること
- 会計ページで料金を手動変更した場合、その値が引き続きデフォルトとして使われること
