# iPhone レイアウト微調整 — SessionSelectPage + 共通 CSS クラス定義

## 背景

iPhone (13:34, 状態バー込み) のスクショレビューで以下の問題を確認:

1. **`bg-app` / `header-gradient` が未定義** — 10+ ページで使われているが
   `src/index.css` に定義がなく、すべて no-op (背景は `--color-background`
   フォールバック、ヘッダーに視覚的区切りなし)
2. **`max-w-6xl` と `max-w-md` の不一致** — `SessionSelectPage.tsx:181` の
   ヘッダー内側 `max-w-6xl` (1152px) は本体 `max-w-md` (448px) と不整合
3. **セーフエリア未対応** — `viewport-fit=cover` 設定済みなのに
   `env(safe-area-inset-top/bottom)` を使っていない (DESIGN.md L107-117 違反)
4. **空状態で `v1134` が中途半端な位置に浮く** — 縦長 iPhone で空 card と
   version の間に大きな空白、画面下部にも巨大な空白

## 設計

### `src/index.css` への追加 (`@layer components`)

```css
.bg-app {
  background-color: var(--color-background);
  min-height: 100dvh;
}

.header-gradient {
  background: linear-gradient(180deg, var(--color-card) 0%, var(--color-background) 100%);
  border-bottom: 1px solid var(--color-border);
}
```

- `bg-app`: DESIGN.md の Level 0 (plain background) に準拠。`min-height: 100dvh`
  で動的ビューポート (iOS Safari のアドレスバー伸縮) に追従。
- `header-gradient`: 既存パレットから派生した極めて淡いグラデ +
  下罫線で、ヘッダーと本体に視覚的区切りを作る。iOS の navbar 感に近い。
  primary blue ではなく中性色を選んだのは、各ページの主役カラーを邪魔しないため。

**影響範囲**: `bg-app` / `header-gradient` を使う全ページ (Session*, History,
Reservation, Accounting*, PlayerSelect, Settings 等) で見た目が変わるが、
いずれも改善方向 (区切りが明確になる、背景が安定する)。

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
