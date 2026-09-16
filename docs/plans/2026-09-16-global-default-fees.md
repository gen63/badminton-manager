# グローバル既定参加費（管理者が開発モードから変更できる基本参加費）

## 背景 / 課題

練習種別ごとの基本参加費は `src/lib/accountingCalc.ts` の `PRACTICE_TYPE_OPTIONS` に
ハードコードされている。会費改定のたびにコード修正＋デプロイが必要で、運用担当が
自力で変えられない。

セッション単位の会費は Firestore `sessions/{id}.accounting.maleFee / femaleFee` に
保存され会計画面から編集できるが、これは「そのセッションだけ」の値であり、
新規セッションの初期値（＝基本参加費）には影響しない。

つまり **「全体デフォルト」層が存在しない**。これを Firestore に持たせ、
開発モードのセッション一覧から編集できるようにする。

## 方針

既にある `appConfig/global` ドキュメント（デフォルト周知事項の置き場、
`2026-07-09-default-announcement.md`）に相乗りする。新しいコレクションも
Security Rules の追加も不要。UI も同ページの「デフォルト周知事項」編集ブロックと
同型にして、実装・操作の両方で学習コストを増やさない。

### 会費の解決順（重要）

```
session.accounting.maleFee/femaleFee   （そのセッションで保存済みの値）
  ↓ 無ければ
appConfig/global.defaultFees[practiceType]   （← 今回追加。管理者が画面から編集）
  ↓ 無ければ
同じ練習種別の直近 accounting レコード     （既存の履歴継承。AccountingPage のみ）
  ↓ 無ければ
PRACTICE_TYPE_OPTIONS                   （コード定数。最終フォールバック）
```

- グローバル既定を**履歴継承より上**に置く。管理者が明示的に決めた値が、
  たまたま残っていた前回の入力値に負けるのは直感に反するため。
- グローバル既定が未設定なら解決順は現行と完全に一致する（後方互換）。
- シャトル価格・体育館代の履歴継承は今回の対象外（従来どおり）。

### データ形状

`appConfig/global` に `defaultFees` フィールドを追加:

```ts
interface DefaultFees {
  fees: Record<string, { maleFee: number; femaleFee: number }>; // key = '複' | '単' | '楽'
  updatedAt: number;
  updatedBy?: string;
}
```

- `fees` は**部分指定を許す**（未設定の種別はコード定数にフォールバック）。
- 練習種別のキーは `PRACTICE_TYPE_OPTIONS` の `value` に従う。未知キーは無視。
- 金額は 0 以上の整数のみ受け付ける（UI と保存時の両方で検証）。

## 変更点

### 1. `src/services/appConfigService.ts`

- `DefaultFees` 型、`getDefaultFees()` / `setDefaultFees(fees, updatedBy)` を追加。
- `fetchDefaultFeesSafe()` — 読み取り失敗（rules 未設定・オフライン等）を warn に
  落として `{}` を返す fail-safe 版。会計画面が開けなくなるのを防ぐ。
  `fetchDefaultAnnouncementTextSafe()` と同じ思想。

### 2. `src/lib/accountingCalc.ts`

- 純粋関数 `resolveFees(practiceType, overrides?)` を追加。
  `overrides?.[practiceType]` があればそれ、無ければ `PRACTICE_TYPE_OPTIONS`、
  それも無ければ `DEFAULT_PRACTICE_TYPE` を返す。
- 既存の `PRACTICE_TYPE_OPTIONS` / `DEFAULT_PRACTICE_TYPE` はそのまま残す
  （最終フォールバックとして必要）。
- `calculateAppropriateFee` の `genderDiff` も `resolveFees` 経由にして、
  グローバル既定で男女差を変えた場合に適正会費の探索が追従するようにする。

### 3. `src/hooks/useDefaultFees.ts`（新規）

- `fetchDefaultFeesSafe()` を呼んで結果を返す hook。
- **モジュールレベルで Promise をキャッシュ**し、画面遷移のたびに Firestore を
  読まない。`invalidateDefaultFeesCache()` を export し、保存直後に破棄する。
- 戻り値は `{ fees, loaded }`。`loaded` が false の間はコード定数で描画し、
  読み込み後に差し替える（初期表示をブロックしない）。

### 4. 会費を参照する画面

- `src/pages/AccountingPage.tsx` — 初期値の解決（:188-205 付近）と
  練習種別ボタンの一括上書き（:774-784 付近）を `resolveFees` 経由に。
- `src/pages/AccountingCalcPage.tsx` — `getDefaults()` と練習種別ボタン（:222-227）。
- `src/pages/MainPage.tsx`（:154-157）/ `src/pages/PlayerSelect.tsx`（:80-83, :145-159）
  — 支払いモーダルの初期金額。`session.accounting` が未保存のセッションで
  グローバル既定が効くようにする。

### 5. `src/pages/SessionSelectPage.tsx` — 編集 UI

- 開発モード限定。「デフォルト周知事項」ブロックの直下に「デフォルト参加費」
  アコーディオンを追加（折りたたみ既定、閉じている間は要約1行）。
- 練習種別3種 × 男/女 の数値入力＋保存ボタン。既存の
  `openDefaultEdit` / `handleSaveDefault` / `savingDefault` / `defaultError` と
  同じ state の持ち方・エラー表示にそろえる。
- 保存成功時に `invalidateDefaultFeesCache()` を呼ぶ。
- 空欄は「その種別は未設定（コード定数を使う）」として扱う。

## やらないこと

- **既存セッションへの遡及適用はしない。** `sessions/{id}.accounting` に保存済みの
  値は変更しない。変更は新規セッション、および会計未入力のセッションから効く。
  これは会計の実績値を後から書き換えないための意図的な制約。
- 履歴（`accountingStore` の `AccountingRecord`）も書き換えない。
- 権限制御は増やさない。`CLAUDE.md` の信頼モデルどおり認証は無いので、
  開発モードコード（`?dev=232`）を知っていれば誰でも変更できる。全体デフォルトを
  クライアントから書ける以上これは避けられず、今回の範囲では受け入れる。
- `settingsStore`（端末ローカル）には持たせない。全端末で同じ値であるべき設定のため。

## テスト

- `accountingCalc.test.ts` — `resolveFees` の解決順（overrides あり/なし/部分指定/
  未知の練習種別）、`calculateAppropriateFee` が overrides の男女差に追従すること。
- `appConfigService` の `fetchDefaultFeesSafe()` が例外時に `{}` を返すこと。
- `useDefaultFees` のキャッシュが 2 回目の呼び出しで Firestore を叩かないこと。

## 完了条件

`npm run build` / `npm run lint` / `npm run test:run` がすべて通ること。
