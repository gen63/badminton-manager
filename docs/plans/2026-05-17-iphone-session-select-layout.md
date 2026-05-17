# iPhone レイアウト微調整 + 未定義 CSS クラスの全削除

## 背景

iPhone (13:34, 状態バー込み) のスクショレビューで以下の問題を確認:

1. **`bg-app` / `header-gradient` / `btn-warning` / `icon-btn` /
   `player-pill*` / `player-name-court` が未定義** — `src/index.css` に
   定義がなく、すべて no-op
2. **`max-w-6xl` と `max-w-md` の不一致** — `SessionSelectPage.tsx:181` の
   ヘッダー内側 `max-w-6xl` (1152px) は本体 `max-w-md` (448px) と不整合
3. **セーフエリア未対応** — `viewport-fit=cover` 設定済みなのに
   `env(safe-area-inset-top/bottom)` を使っていない (DESIGN.md L107-117 違反)
4. **空状態で `v1134` が中途半端な位置に浮く** — 縦長 iPhone で空 card と
   version の間に大きな空白、画面下部にも巨大な空白

## 設計

### `src/index.css` の変更

未定義クラスは定義せず、`body` に背景色を集約:

```css
body {
  background-color: var(--color-background);
  min-height: 100dvh;
}
```

- `min-height: 100dvh` で iOS Safari のアドレスバー伸縮にも追従。
- `bg-app` を全 .tsx から削除しても、`body` が常に `--color-background` を
  描画するため見た目は変わらない。
- `header-gradient` はクラス自体を削除。ヘッダーと本体が同色 (背景) で
  繋がるが、これは元の no-op 状態と同じ視覚 (ユーザー運用で問題なし)。

### 未定義クラスの一括削除

| クラス | 出現箇所 | 対応 |
|--------|----------|------|
| `bg-app` | App / ErrorBoundary / Settings / SessionSelect / History / Reservation / SessionJoin / AccountingCalc / SessionCreate / Accounting / PlayerSelect | className から削除 (`body` で代替) |
| `header-gradient` | Settings / SessionSelect / History / Reservation / AccountingCalc / SessionCreate / Accounting / PlayerSelect | 削除 |
| `btn-warning` | CourtCard:205 (終了ボタン) | 削除 |
| `icon-btn` | History:336,344 / Settings:238 | 削除 |
| `player-pill*` / `player-name-court` | CourtCard:49-57 | 削除 |

副作用として `CourtCard` の `gender` 変数が未使用になるため、
`getPlayerGender` の destructure 除去 (interface は optional のまま残し
呼び出し側互換は維持)。

### `src/pages/SessionSelectPage.tsx` の修正

- `L178` 最外 div: `min-h-screen` → `flex flex-col` 追加 (`min-h-screen`
  は `bg-app` の `min-height: 100dvh` に統合可能だが、念のため残す)
- `L180` ヘッダー: `pt-3` をセーフエリア対応に
  (`style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}`)
- `L181`: `max-w-6xl` → `max-w-md` で本体と統一
- `L186` 本体 div: `flex-1 flex flex-col` を追加し、最下部要素を `mt-auto`
  で底に押し付け
- `L293-295` version label: `mt-auto` + safe-area-inset-bottom padding を付与

### スキップする調整

- **ヘッダータイトル `text-lg` の拡大**: クロスページ一貫性 (他ページの
  ヘッダーも `text-lg`) を優先し、見送り
- **空状態カード自体の縦中央寄せ**: devMode の作成ボタンが下にきた時の
  挙動が読みにくくなるため、card は上部に固定、version だけ下に押し付ける

## テスト計画

- `npm run build` / `npm run lint` / `npm run test:run` 通過
- iPhone Safari (notch あり / なし) で:
  - セッション 0 件: version が画面下部に張り付き、Dynamic Island が
    タイトルに被らない
  - セッションあり: 上から自然に流れ、version は下端
- 他ページ (History, Accounting 等) のヘッダー区切りが追加されても
  破綻しないこと
