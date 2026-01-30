# デザインガイドライン

バドミントン練習管理アプリのUIデザイン統一ルール

---

## 🧠 UXの原則（Laws of UX）

デザイン判断の根拠となる心理学的原則：

| 法則 | 内容 | 適用 |
|------|------|------|
| **Fitts's Law** | ターゲットが大きく近いほど、素早く正確にタップできる | ボタンは大きく、よく使う機能は手の届く位置に |
| **Hick's Law** | 選択肢が多いほど決定に時間がかかる | 選択肢は最小限に。段階的に絞り込む |
| **Miller's Law** | 人は7±2個の情報しか短期記憶できない | リストは5-9項目に。それ以上はグループ化 |
| **Doherty Threshold** | 400ms以内のレスポンスで生産性が向上 | ローディングは400ms以内に。それ以上は進捗表示 |
| **Jakob's Law** | ユーザーは他サイトでの経験を期待する | 標準的なUIパターンを使う |
| **Peak-End Rule** | 体験はピークと終わりで評価される | 完了画面を気持ちよく。エラーは丁寧に |

---

## 1. タッチターゲット（🍎 iOS推奨）

### 最小サイズ
- **タップ可能な要素は最低44×44px（約1cm×1cm）を確保**
- Apple Human Interface Guidelinesでは44pt推奨
- 研究では48px以上で最も正確なタップが可能

### 推奨サイズ
| 優先度 | サイズ | 用途 |
|--------|--------|------|
| 高（プライマリ） | 72px（`py-4`〜`py-5`） | メインアクション |
| 中（セカンダリ） | 60px（`py-3`〜`py-4`） | 一般的なボタン |
| 低（ターシャリ） | 44-48px（`py-2`〜`py-3`） | 補助的なアクション |

### ボタン間の間隔
| ボタンサイズ | 推奨間隔 |
|--------------|----------|
| 大（72px） | 12-24px（`gap-3`〜`gap-6`） |
| 中（60px） | 24-36px（`gap-6`〜`gap-9`） |
| 小（44px） | 36-48px（`gap-9`〜`gap-12`） |

**原則**: 小さいボタンほど間隔を広く取る（誤タップ防止）

### Fat Finger対策
```css
/* アイコンは小さくても、タップ領域は大きく */
.icon-button {
  padding: 12px;  /* 24px icon + 12px*2 = 48px */
}
```

---

## 2. 余白のルール

### 画面端の余白（セーフエリア考慮）
- **最低20pxの余白を死守する**
- iPhone X以降のノッチ・角丸対応
- 下部のホームインジケーター領域を避ける

### セーフエリア対応（🍎 iOS必須）
```css
/* viewport設定 */
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">

/* 既存の余白とセーフエリアの大きい方を採用 */
padding-left: max(20px, env(safe-area-inset-left));
padding-right: max(20px, env(safe-area-inset-right));
padding-bottom: max(20px, env(safe-area-inset-bottom));
```

### 垂直方向の余白
- セクション間: `space-y-4`（16px）
- カード内の要素間: `space-y-2`（8px）
- ラベルとコンテンツ間: `mb-2`（8px）

### 水平方向の余白
- ボタン間: `gap-3`（12px）以上
- カード内パディング: `p-4`（16px）

---

## 3. カードデザイン

### 基本スタイル
```
bg-white rounded-2xl shadow-sm p-4
```

### カードの使い方
- バラバラな情報を直接背景に置かない
- 白い角丸のボックス（カード）の中に情報を整理
- 構造がスッキリ見える

### カード内の構成
- タイトル → コンテンツ → アクション（上から下）
- 左揃えを基本とする
- 重要な情報は上に配置

---

## 4. 配色ルール

### メインカラー（3色に絞る）
| 用途 | 色 | Tailwind |
|------|-----|----------|
| メイン（アクション） | 青 | `blue-500` |
| 成功（開始・完了） | 緑 | `green-500` |
| 警告（削除・終了） | 赤/オレンジ | `red-500` / `orange-500` |

### ニュートラルカラー
| 用途 | 色 | Tailwind |
|------|-----|----------|
| 背景 | 薄いグレー | `gray-100` |
| カード背景 | 白 | `white` |
| テキスト（メイン） | 濃いグレー | `gray-800` |
| テキスト（サブ） | 中間グレー | `gray-500` / `gray-600` |
| ボーダー | 薄いグレー | `gray-200` |
| 無効状態 | 薄いグレー | `gray-400` + `opacity-50` |

### アクセシビリティ（コントラスト比）
- **テキスト**: 4.5:1以上（WCAG AA準拠）
- **大きいテキスト（18px以上）**: 3:1以上
- `gray-600` on `white` = 5.74:1 ✓
- `gray-500` on `white` = 4.64:1 ✓
- `gray-400` on `white` = 2.87:1 ⚠️（補足のみ）

---

## 5. タイポグラフィ

### フォント（🍎 iOS推奨）
```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
```

### フォントサイズのヒエラルキー
| 役割 | サイズ | Tailwind | スタイル |
|------|--------|----------|----------|
| メインタイトル | 22-24px | `text-xl` / `text-2xl` | Bold |
| セクション見出し | 17-18px | `text-base` / `text-lg` | Bold / Semibold |
| 本文・ラベル | 15-17px | `text-sm` / `text-base` | Regular |
| 補足・注釈 | 13-15px | `text-xs` / `text-sm` | Regular / Gray |

### 文字色の優先順位
1. **主要情報**: `text-gray-800`（濃い）
2. **副次情報**: `text-gray-600`
3. **補足情報**: `text-gray-500`（薄め、コントラスト注意）

---

## 6. コンポーネントの統一

### ボタンスタイル

#### プライマリボタン
```
bg-blue-500 text-white rounded-full font-medium py-3 px-6 
hover:bg-blue-600 active:bg-blue-700 active:scale-[0.98]
min-h-[44px] transition-all duration-150
```

#### セカンダリボタン
```
bg-gray-100 text-gray-600 rounded-full font-medium py-3 px-6
hover:bg-gray-200 active:bg-gray-300 active:scale-[0.98]
min-h-[44px] transition-all duration-150
```

#### 危険ボタン
```
bg-red-500 text-white rounded-full font-medium py-3 px-6
hover:bg-red-600 active:bg-red-700 active:scale-[0.98]
min-h-[44px] transition-all duration-150
```

#### 無効状態
```
opacity-50 cursor-not-allowed
```

### 選択状態
- **選択中**: `bg-blue-500 text-white shadow-lg ring-2 ring-blue-300 scale-105`
- **非選択**: `bg-gray-100 text-gray-500`
- チェックマーク（✓）を表示

### 入力フィールド（🍎 iOS対応）
```
bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 
focus:ring-2 focus:ring-blue-300 focus:border-transparent
text-base  /* 16px以上でiOS自動ズーム防止 */
```

---

## 7. アニメーション・トランジション

### パフォーマンス原則
**GPU加速されるプロパティのみ使用**:
- ✅ `transform`（translate, scale, rotate）
- ✅ `opacity`
- ❌ `width`, `height`, `top`, `left`（レイアウト再計算が発生）

### タイミング
| 用途 | 時間 | イージング |
|------|------|-----------|
| マイクロインタラクション（ホバー、タップ） | 100-150ms | `ease-out` |
| 画面遷移 | 200-300ms | `ease-in-out` |
| モーダル開閉 | 200-250ms | `ease-out` |
| ローディング | 継続 | `linear` |

### Tailwind実装
```css
/* ボタンのタップフィードバック */
transition-all duration-150 ease-out
active:scale-[0.98] active:opacity-90

/* フェードイン */
transition-opacity duration-200 ease-out

/* スライドイン */
transition-transform duration-300 ease-out
```

### 避けるべきこと
- 300ms以上のアニメーション（ユーザーを待たせる）
- 画面全体のアニメーション（酔いやすい）
- `prefers-reduced-motion` を尊重

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 8. 状態デザイン

### ローディング状態
```jsx
// スピナー（400ms以上かかる処理）
<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />

// スケルトン（コンテンツ読み込み中）
<div className="animate-pulse bg-gray-200 rounded-xl h-20" />
```

**原則**: 400ms以内に完了する処理はローディング表示不要（Doherty Threshold）

### 空の状態（Empty State）
```jsx
<div className="text-center py-12">
  <span className="text-4xl mb-4 block">🏸</span>
  <h3 className="text-base font-semibold text-gray-700 mb-2">
    まだ試合がありません
  </h3>
  <p className="text-sm text-gray-500 mb-4">
    メイン画面でゲームを開始すると、ここに履歴が表示されます。
  </p>
  <button className="bg-blue-500 text-white px-6 py-2 rounded-full">
    メイン画面へ
  </button>
</div>
```

### エラー状態
```jsx
// インラインエラー（フォーム）
<p className="text-red-500 text-sm mt-1">入力内容を確認してください</p>

// トーストエラー
<div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl">
  エラーが発生しました
</div>
```

### 成功状態
```jsx
// トースト成功
<div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl">
  保存しました ✓
</div>
```

---

## 9. iOS Safari固有の対応

### フォームスタイルのリセット
```css
input, textarea, select, button {
  -webkit-appearance: none;
  appearance: none;
}
```

### タップハイライトの制御
```css
* {
  -webkit-tap-highlight-color: transparent;
}
```

### スクロールの最適化
```css
.scrollable {
  -webkit-overflow-scrolling: touch;
  overflow-y: auto;
}

body {
  overscroll-behavior-y: none; /* プルトゥリフレッシュ無効化 */
}
```

### 固定ヘッダー・フッター
```css
.fixed-header {
  position: fixed;
  top: 0;
  padding-top: env(safe-area-inset-top);
}

.fixed-footer {
  position: fixed;
  bottom: 0;
  padding-bottom: env(safe-area-inset-bottom);
}
```

---

## 10. モバイルUXの考慮事項

### 片手操作
- **重要なボタンは画面下部に配置**（親指が届く範囲）
- 画面上部は情報表示に使用
- 横幅いっぱいのボタンは押しやすい

---

## 11. アクセシビリティ

### 必須対応
- [ ] タップターゲット44×44px以上
- [ ] テキストコントラスト比4.5:1以上
- [ ] フォーカス状態が視認可能
- [ ] エラーは色だけでなくテキストでも伝える

### フォーカス状態
```css
/* キーボードナビゲーション用 */
:focus-visible {
  outline: 2px solid #3B82F6;
  outline-offset: 2px;
}
```

### スクリーンリーダー対応
```jsx
// アイコンのみのボタン
<button aria-label="削除">
  <Trash2 size={20} />
</button>

// ローディング状態
<div aria-live="polite" aria-busy="true">
  読み込み中...
</div>
```

---

## チェックリスト

### ⚠️ 実装時に必ず確認すること

以下のルールは**必須**です。違反している場合はデプロイ前に修正してください。

### 基本（余白・レイアウト）
- [ ] **画面端に20px以上の余白があるか** → `p-5`(20px)以上を使用（`p-4`は16pxで不足！）
- [ ] ページのメインコンテナは `max-w-XXX mx-auto p-5` 以上
- [ ] 情報がカードで整理されているか
- [ ] 色は3色以内に収まっているか
- [ ] フォントサイズに優先順位があるか
- [ ] ボタンスタイルは統一されているか

### タップターゲット
- [ ] **すべてのタップ可能要素が44×44px以上か** → `min-h-[44px] min-w-[44px]`
- [ ] ボタン間に十分な間隔があるか → 小さいボタンほど`gap`を広く
- [ ] 重要なアクションは画面下部にあるか

### iOS Safari対応
- [ ] **input/textareaのフォントサイズが16px以上か** → `text-base`以上（自動ズーム防止）
- [ ] セーフエリアを考慮しているか
- [ ] `-webkit-appearance: none` を設定しているか

### 状態デザイン
- [ ] ローディング状態があるか（400ms以上の処理）
- [ ] 空の状態にガイダンスがあるか
- [ ] エラー状態が明確か
- [ ] タップ時のフィードバックがあるか → `active:scale-[0.98]`

### アニメーション
- [ ] transform/opacityのみ使用しているか
- [ ] 300ms以下に収まっているか → `duration-150` or `duration-200`
- [ ] prefers-reduced-motionを尊重しているか

### アクセシビリティ
- [ ] コントラスト比4.5:1以上か
- [ ] フォーカス状態が見えるか
- [ ] アイコンボタンにaria-labelがあるか

### Tailwind早見表
| 目的 | 使うべき | 使わない |
|------|----------|----------|
| 画面端余白 | `p-5`(20px), `p-6`(24px) | `p-4`(16px)以下 |
| タップ領域 | `min-h-[44px]` | `h-8`(32px)以下 |
| フォント（入力） | `text-base`(16px)以上 | `text-sm`(14px)以下 |
| アニメ時間 | `duration-150`, `duration-200` | `duration-500`以上 |

---

## 参考リソース

### Apple / iOS
- [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [Designing Websites for iPhone X](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)

### UX研究
- [Touch Targets on Touchscreens (NN/g)](https://www.nngroup.com/articles/touch-target-size/)
- [Mobile User Experience (NN/g)](https://www.nngroup.com/articles/mobile-ux/)
- [Laws of UX](https://lawsofux.com/)

### アクセシビリティ
- [WCAG 2.1 Target Size](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html)
- [Accessible tap targets (web.dev)](https://web.dev/articles/accessible-tap-targets)

### パフォーマンス
- [High-performance CSS animations](https://web.dev/articles/animations-guide)

---

**最終更新**: 2026-01-31
