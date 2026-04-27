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

## 関連修正: AccountingPage の records ベース初期化

`session.accounting` 未保存のときに `AccountingPage` を開くと、
`useEffect` が **過去レコードの直近の料金をそのまま採用** していた
（`AccountingPage.tsx:168-187`）。
過去が `複 (800/600)`、新セッションが `単` の場合、料金は 800/600 に
初期化される。ユーザーが同画面で別フィールド（参加人数等）を編集すると
`saveAllInputs` 経由で `session.accounting.maleFee=800` が保存され、
PlayerSelect/MainPage 側の修正をすり抜けて結局誤った既定値が使われる。

修正後のロジック:

1. **料金 (`maleFee`/`femaleFee`)**: 同じ練習種別の直近レコードがあれば
   それを採用。なければ `PRACTICE_TYPE_OPTIONS` の練習種別ベースの
   標準料金を使う。旧形式 (`ダブルス`/`シングルス`/`初級`) のレコードも
   `normalizeType` で正規化してマッチさせる。
2. **シャトル価格 (`shuttlePrice`)**: 練習種別と独立なので、これまで通り
   直近レコードから継承。
3. **体育館代 (`gymCost`)**: 既存ロジック維持（同じ体育館の直近 → 固定値）。

これによって `session.accounting` に保存される料金が
常に練習種別と整合するようになる。

## コメント整理

`PlayerSelect.tsx` と `MainPage.tsx` の `handlePaymentClick` 内に
「デフォルト金額（会計設定から）」というコメントが残っていたが、
今回の修正で「会計設定」だけでなく練習種別も参照するようになったため
誤解を招く。CLAUDE.md の「明らかな WHAT は書かない」方針にも沿って削除。
（性別不明 → 男性料金 のロジックを説明するコメントは
 非自明な意思決定なので残す）

## 動作確認

- `npm run build` / `npm run lint` / `npm run test:run` がすべて通ること
- 練習種別 `単` の新規セッションで会計ページ未訪問のまま参加者管理から支払いを
  押したとき、男性 1200 / 女性 800 がデフォルトで入ること
- 練習種別 `楽` で同様に 600 / 400 がデフォルトになること
- 会計ページで料金を手動変更した場合、その値が引き続きデフォルトとして使われること
