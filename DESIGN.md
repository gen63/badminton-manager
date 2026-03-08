# デザインガイドライン

バドミントン練習管理アプリのUIデザイン統一ルール

---

## 🎨 デザイン原則

### Card-based UI

情報を視覚的に区切られた「カード」と呼ばれる矩形のコンテナに配置する手法です。

**原則:**
- 関連する情報のまとまりを1つのカードに
- カードごとに明確な目的を持たせる
- カード間で視覚的な区切りを明確に

### Elevation（高度）システム

影の深さによって要素の重要度や階層を表現します。

| レベル | 用途 | Tailwind | 説明 |
|--------|------|----------|------|
| **Level 0** | 背景 | なし | ページ背景 |
| **Level 1** | カード | `shadow-md` | 通常のカード |
| **Level 2** | アクティブ/モーダル | `shadow-lg` | フォーカス状態、モーダル |
| **Level 3** | フローティング | `shadow-xl` | FAB、ドロップダウン |

**原則:** 高いレベルほどユーザーの注目を集める

### UXの法則

デザイン判断の根拠となる心理学的原則。詳細は [Laws of UX](https://lawsofux.com/) を参照。

| 法則 | 適用例 |
|------|--------|
| **Fitts's Law** | ボタンは大きく、よく使う機能は手の届く位置に |
| **Hick's Law** | 選択肢は最小限に。段階的に絞り込む |
| **Miller's Law** | リストは5-9項目に。それ以上はグループ化 |
| **Doherty Threshold** | ローディングは400ms以内に。それ以上は進捗表示 |
| **Jakob's Law** | 標準的なUIパターンを使う |
| **Peak-End Rule** | 完了画面を気持ちよく。エラーは丁寧に |

---

## 📏 スペーシング（余白）

### 8ポイントグリッドシステム

すべての余白は **8pxを基本単位** とし、その倍数で設定します。

| 値 | Tailwind | 用途 |
|-----|----------|------|
| 8px | `p-2`, `gap-2` | 密接に関連する要素間 |
| 12px | `p-3`, `gap-3` | 標準的な要素間 |
| 16px | `p-4`, `gap-4` | 独立した要素間、画面端パディング |
| 24px | `p-6`, `gap-6` | カード内パディング、セクション間 |
| 32px | `p-8`, `gap-8` | 大きなセクション間 |

### 階層的なスペーシング

外側から内側に向かって段階的に余白を設定する入れ子構造を採用。

```
画面全体（16px パディング）
  └─ カード（24px パディング）
       └─ セクション間（16px 間隔）
            └─ ラベル↔入力（8px 間隔）
```

| 階層 | 値 | Tailwind |
|------|-----|----------|
| **画面端** | 16px | `px-4`, `py-4` |
| **カード内** | 24px | `p-6` |
| **カード間** | 24px | `space-y-6`, `mb-6` |
| **フォーム項目間** | 16px | `space-y-4` |
| **ラベル↔入力** | 8px | `mb-2` |

**原則:** 関係が近いものほど余白を狭く、遠いものほど広く

### タッチターゲット

**タップ可能な要素は最低44×44px（iOS推奨）を確保**

| 優先度 | サイズ | 用途 |
|--------|--------|------|
| 高（プライマリ） | 72px | メインアクション |
| 中（セカンダリ） | 60px | 一般的なボタン |
| 低（ターシャリ） | 44-48px | 補助的なアクション |

**例外（使用頻度が低いボタン）:**
- コート削除ボタン（×）: 24px（`w-6 h-6`）
- 休憩ボタン（コーヒー）: 24px（`w-6 h-6`）

これらは誤タップのリスクが低く、UI を圧迫しないため小さく保つ。

### ボタン間隔

**小さいボタンほど間隔を広く取る（誤タップ防止）**

| ボタンサイズ | 推奨間隔 |
|--------------|----------|
| 大（72px） | 12-24px（`gap-3`〜`gap-6`） |
| 中（60px） | 24-36px（`gap-6`〜`gap-9`） |
| 小（44px） | 36-48px（`gap-9`〜`gap-12`） |

### iOS セーフエリア対応

```css
/* viewport設定 */
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">

/* 既存の余白とセーフエリアの大きい方を採用 */
padding-left: max(16px, env(safe-area-inset-left));
padding-right: max(16px, env(safe-area-inset-right));
padding-bottom: max(16px, env(safe-area-inset-bottom));
```

---

## 🎨 カラーシステム

### セマンティックカラー

色に機能的な意味を持たせ、ユーザーが学習しやすい色の使い方を実践。

| 色 | 意味 | Tailwind | 用途 |
|-----|------|----------|------|
| **Blue** | プライマリ/アクション | `primary` | メインボタン、選択状態、リンク |
| **Green** | 成功/追加/開始 | `green-500` | 追加ボタン、開始ボタン、成功メッセージ |
| **Orange** | 警告/終了 | `orange-500` | 終了ボタン、警告メッセージ |
| **Red** | 危険/削除 | `destructive` | 削除ボタン、リセット、エラー |

**原則:** 同じ意味には同じ色を一貫して使用

### ニュートラルカラー（shadcn/ui変数）

| 用途 | Tailwind |
|------|----------|
| 背景 | `bg-background` |
| カード背景 | `bg-card` |
| テキスト（メイン） | `text-foreground` |
| テキスト（サブ） | `text-muted-foreground` |
| ボーダー | `border-border` |
| 入力背景 | `bg-input` |
| 無効状態 | `text-muted-foreground` + `opacity-50` |

### アクセシビリティ（コントラスト比）

- **テキスト**: 4.5:1以上（WCAG AA準拠）
- **大きいテキスト（18px以上）**: 3:1以上
- shadcn/ui変数は自動でコントラスト比を確保

---

## 📝 タイポグラフィ

### システムフォント

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
```

### フォントサイズのヒエラルキー

| 役割 | サイズ | Tailwind | スタイル |
|------|--------|----------|----------|
| メインタイトル | 22-24px | `text-xl` / `text-2xl` | Bold |
| セクション見出し | 17-18px | `text-base` / `text-lg` | Bold / Semibold |
| 本文・ラベル | 15-17px | `text-sm` / `text-base` | Regular |
| 補足・注釈 | 13-15px | `text-xs` / `text-sm` | Regular |

### 文字色の優先順位

1. **主要情報**: `text-foreground`
2. **副次情報**: `text-foreground` + 低opacity
3. **補足情報**: `text-muted-foreground`

---

## 🧩 コンポーネント

### ボタン

#### プライマリボタン
```
bg-primary text-primary-foreground rounded-full font-medium py-3 px-6 
hover:bg-primary/90 active:bg-primary/80 active:scale-[0.98]
min-h-[44px] transition-all duration-150
```

#### セカンダリボタン
```
bg-secondary text-secondary-foreground rounded-full font-medium py-3 px-6
hover:bg-secondary/80 active:bg-secondary/70 active:scale-[0.98]
min-h-[44px] transition-all duration-150
```

#### 危険ボタン
```
bg-destructive text-destructive-foreground rounded-full font-medium py-3 px-6
hover:bg-destructive/90 active:bg-destructive/80 active:scale-[0.98]
min-h-[44px] transition-all duration-150
```

#### 無効状態
```
opacity-50 cursor-not-allowed
```

### カード

#### 基本スタイル
```
bg-card border border-border rounded-2xl shadow-md p-6
```

**標準パディング:** 24px（`p-6`）

#### カード内の構成
- タイトル → コンテンツ → アクション（上から下）
- 左揃えを基本とする
- 重要な情報は上に配置

### 入力フィールド

```
bg-input border border-border rounded-xl px-4 py-3 
focus:ring-2 focus:ring-primary/50 focus:border-transparent
text-base  /* 16px以上でiOS自動ズーム防止 */
```

**iOS対応必須:**
- フォントサイズ16px以上（`text-base`）
- `-webkit-appearance: none`

### 選択状態

- **選択中**: `bg-primary text-primary-foreground shadow-lg ring-2 ring-primary/30 scale-105`
- **非選択**: `bg-secondary text-secondary-foreground`
- チェックマーク（✓）を表示

---

## ✨ インタラクション

### アニメーション

#### パフォーマンス原則
**GPU加速されるプロパティのみ使用:**
- ✅ `transform`（translate, scale, rotate）
- ✅ `opacity`
- ❌ `width`, `height`, `top`, `left`

#### タイミング

| 用途 | 時間 | イージング |
|------|------|-----------|
| タップフィードバック | 100-150ms | `ease-out` |
| 画面遷移 | 200-300ms | `ease-in-out` |
| モーダル開閉 | 200-250ms | `ease-out` |

#### Tailwind実装
```css
/* ボタンのタップフィードバック */
transition-all duration-150 ease-out
active:scale-[0.98] active:opacity-90

/* フェードイン */
transition-opacity duration-200 ease-out
```

#### アクセシビリティ配慮
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 状態デザイン

#### ローディング
```jsx
// スピナー（400ms以上かかる処理のみ）
<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />

// スケルトン
<div className="animate-pulse bg-muted rounded-xl h-20" />
```

**原則:** 400ms以内の処理はローディング表示不要（Doherty Threshold）

#### 空の状態
```jsx
<div className="text-center py-12">
  <span className="text-4xl mb-4 block">🏸</span>
  <h3 className="text-base font-semibold text-foreground mb-2">
    まだ試合がありません
  </h3>
  <p className="text-sm text-muted-foreground mb-4">
    メイン画面でゲームを開始すると、ここに履歴が表示されます。
  </p>
  <button className="bg-primary text-primary-foreground px-6 py-2 rounded-full">
    メイン画面へ
  </button>
</div>
```

#### エラー
```jsx
// インラインエラー
<p className="text-destructive text-sm mt-1">入力内容を確認してください</p>

// トーストエラー
<div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-xl">
  エラーが発生しました
</div>
```

#### 成功
```jsx
<div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl">
  保存しました ✓
</div>
```

---

## 📱 プラットフォーム対応

### iOS Safari

#### フォームスタイルのリセット
```css
input, textarea, select, button {
  -webkit-appearance: none;
  appearance: none;
}
```

#### タップハイライトの制御
```css
* {
  -webkit-tap-highlight-color: transparent;
}
```

#### スクロール最適化
```css
.scrollable {
  -webkit-overflow-scrolling: touch;
  overflow-y: auto;
}

body {
  overscroll-behavior-y: none; /* プルトゥリフレッシュ無効化 */
}
```

### レイアウト安定性（CLS対策）

**コンテンツが突然動くと、ユーザーは意図しない場所をタップしたり、読んでいた場所を見失います。**

#### 基本原則

| ルール | 実装方法 |
|--------|----------|
| **高さを事前に確保** | `min-height`, `h-[固定値]` |
| **flexで高さを揃える** | `items-stretch` + `flex` |
| **スペースを予約** | プレースホルダー, `invisible` |
| **アスペクト比を固定** | `aspect-ratio` |

#### 実装パターン

**並列カードの高さを揃える:**
```jsx
<div className="flex items-stretch gap-4">
  {items.map(item => (
    <div className="flex" style={{ width: '33%' }}>
      <Card className="flex flex-col w-full">
        <div className="flex-1">{content}</div>
        <div>{buttons}</div>
      </Card>
    </div>
  ))}
</div>
```

**条件付き表示でスペースを確保:**
```jsx
{/* ❌ 悪い例: 表示時にレイアウトがジャンプ */}
{error && <ErrorMessage />}

{/* ✅ 良い例: スペースを常に確保 */}
<div className="min-h-[24px]">
  {error && <ErrorMessage />}
</div>
```

**スケルトンローディング:**
```jsx
{isLoading ? (
  <div className="h-[180px] bg-muted rounded-xl animate-pulse" />
) : (
  <ActualContent />
)}
```

#### チェック方法

1. **Chrome DevTools** → Performance → "Layout Shift Regions" を有効化
2. **Lighthouse** → Core Web Vitals → CLS スコアを確認（0.1未満が良好）
3. **手動確認**: 状態変化時に周囲の要素が動かないか目視

---

## ✅ チェックリスト

### 実装時に必ず確認すること

#### 基本（余白・レイアウト）
- [ ] **画面端に16px以上の余白** → `p-4` 以上
- [ ] ページのメインコンテナは `max-w-XXX mx-auto p-4`
- [ ] 情報がカードで整理されている
- [ ] カードパディングは24px（`p-6`）

#### タッチターゲット
- [ ] **すべてのタップ可能要素が44×44px以上** → `min-h-[44px]`
- [ ] ボタン間に十分な間隔 → 小さいボタンほど`gap`を広く
- [ ] 重要なアクションは画面下部

#### iOS Safari対応
- [ ] **input/textareaのフォントサイズが16px以上** → `text-base` 以上
- [ ] セーフエリアを考慮
- [ ] `-webkit-appearance: none` を設定

#### 状態デザイン
- [ ] ローディング状態がある（400ms以上の処理）
- [ ] 空の状態にガイダンス
- [ ] エラー状態が明確
- [ ] タップ時のフィードバック → `active:scale-[0.98]`

#### アニメーション
- [ ] transform/opacityのみ使用
- [ ] 300ms以下 → `duration-150` or `duration-200`
- [ ] prefers-reduced-motionを尊重

#### レイアウト安定性
- [ ] **並列カードの高さは揃っている** → `flex` + `items-stretch`
- [ ] **動的コンテンツに最小高さ** → `min-h-[XXXpx]`
- [ ] **条件付き表示でレイアウトがジャンプしない** → スペース予約
- [ ] 状態変化時に周囲の要素が動かないか目視確認

#### アクセシビリティ
- [ ] コントラスト比4.5:1以上
- [ ] フォーカス状態が見える
- [ ] アイコンボタンに`aria-label`

### Tailwind早見表

| 目的 | 使うべき | 使わない |
|------|----------|----------|
| 画面端余白 | `p-4`(16px), `p-6`(24px) | `p-2`(8px)以下 |
| タップ領域 | `min-h-[44px]` | `h-8`(32px)以下 |
| フォント（入力） | `text-base`(16px)以上 | `text-sm`(14px)以下 |
| アニメ時間 | `duration-150`, `duration-200` | `duration-500`以上 |

---

## 📚 参考リソース

- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [Laws of UX](https://lawsofux.com/)
- [WCAG 2.1 Target Size](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html)
- [shadcn/ui](https://ui.shadcn.com/)

---

**最終更新**: 2026-03-08
