# デザインガイドライン

バドミントン練習管理アプリのUIデザイン統一ルール

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
- タップターゲットが視覚的に小さくても、パディングで実際のタップ領域を拡大
- 例: アイコン24pxでも、周囲にパディングを追加して44px以上に
```css
/* アイコンボタン例 */
.icon-button {
  padding: 12px;  /* 24px + 12px*2 = 48px */
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

/* セーフエリアを考慮したパディング */
padding-top: env(safe-area-inset-top);
padding-right: env(safe-area-inset-right);
padding-bottom: env(safe-area-inset-bottom);
padding-left: env(safe-area-inset-left);

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

### 色の使い分け
- それ以外は薄いグレーと黒で構成
- 同じ意味には同じ色を使う
- 色のトーンを統一する（彩度・明度を揃える）

---

## 5. タイポグラフィ

### フォント（🍎 iOS推奨）
- **システムフォントを使用**（San Francisco自動適用）
- `-apple-system, BlinkMacSystemFont` を最優先
```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
```

### iOSでの読みやすいサイズ
- **本文の最小サイズ: 17px**（Apple推奨）
- 小さくても **11px以上**を維持

### フォントサイズのヒエラルキー

#### 推奨サイズスケール（iPhone基準）
| 役割 | サイズ | Tailwind | スタイル |
|------|--------|----------|----------|
| メインタイトル | 22-24px | `text-xl` / `text-2xl` | Bold |
| セクション見出し | 17-18px | `text-base` / `text-lg` | Bold / Semibold |
| 本文・ラベル | 15-17px | `text-sm` / `text-base` | Regular |
| 補足・注釈 | 13-15px | `text-xs` / `text-sm` | Regular / Gray |

#### 現在の実装
| 用途 | Tailwind |
|------|----------|
| ページタイトル | `text-base font-medium` |
| セクションタイトル | `text-base font-semibold` |
| 本文 | `text-sm` |
| 補足テキスト | `text-xs` |
| ボタン | `text-sm font-medium` |

### タイトル周りの余白ルール
- 文字サイズではなく**余白で存在感を出す**
- すべての画面で「上端からタイトルまでの距離」を統一

### 文字色の優先順位
1. **主要情報**: `text-gray-800`（濃い）
2. **副次情報**: `text-gray-600`
3. **補足情報**: `text-gray-400`（薄い）

---

## 6. コンポーネントの統一

### ボタンスタイル（🍎 タップしやすく）

#### プライマリボタン（メインアクション）
```
bg-blue-500 text-white rounded-full font-medium py-3 px-6 
hover:bg-blue-600 active:bg-blue-700
min-h-[44px]
```

#### セカンダリボタン（サブアクション）
```
bg-gray-100 text-gray-600 rounded-full font-medium py-3 px-6
hover:bg-gray-200 active:bg-gray-300
min-h-[44px]
```

#### 危険ボタン（削除など）
```
bg-red-500 text-white rounded-full font-medium py-3 px-6
hover:bg-red-600 active:bg-red-700
min-h-[44px]
```

#### アイコンボタン
```
p-3 rounded-full hover:bg-gray-100 active:bg-gray-200
min-w-[44px] min-h-[44px]
```

### 選択状態
- **選択中**: `bg-blue-500 text-white shadow-lg ring-2 ring-blue-300 scale-105`
- **非選択**: `bg-gray-100 text-gray-500`
- チェックマーク（✓）を表示

### 入力フィールド（🍎 iOS対応）
```
bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 
focus:ring-2 focus:ring-blue-300 focus:border-transparent
text-base  /* iOSの自動ズーム防止: 16px以上 */
```

**重要**: フォントサイズ16px未満だとiOS Safariが自動ズームする

### アイコン
- 線の太さを統一
- サイズは `size={18}` または `size={20}` を基本
- タップ領域は44px以上確保

---

## 7. iOS Safari固有の対応

### フォームスタイルのリセット
```css
input, textarea, select, button {
  -webkit-appearance: none;
  appearance: none;
  border-radius: 0;  /* iOSデフォルトの角丸を無効化 */
}

/* 必要に応じて角丸を再設定 */
input, textarea {
  border-radius: 12px;
}
```

### タップハイライトの制御
```css
/* タップ時の青い/グレーのハイライトを無効化 */
* {
  -webkit-tap-highlight-color: transparent;
}

/* 代わりにactive状態で視覚フィードバック */
button:active {
  opacity: 0.7;
  transform: scale(0.98);
}
```

### スクロールの最適化
```css
/* スムーズスクロール（慣性スクロール） */
.scrollable {
  -webkit-overflow-scrolling: touch;
  overflow-y: auto;
}

/* プルトゥリフレッシュの無効化（必要に応じて） */
body {
  overscroll-behavior-y: none;
}
```

### 固定ヘッダー・フッター
```css
.fixed-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  padding-top: env(safe-area-inset-top);
}

.fixed-footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding-bottom: env(safe-area-inset-bottom);
}
```

### ダークモード対応（任意）
```css
@media (prefers-color-scheme: dark) {
  /* ダークモード用スタイル */
}
```

---

## 8. 情報の構造化

### リスト表示
- 単なるテキストの羅列を避ける
- 各項目をカード化またはボーダーで区切る
- タップ可能なリストアイテムは44px以上の高さ

### アクションボタンの配置
- 右側に配置
- アイコンのみでコンパクトに（ただし44px確保）
- ホバー/アクティブ時に色が変わる

---

## 9. レスポンシブ対応

### モバイルファースト
- 主要なターゲットはスマートフォン
- 3カラムまで横スクロールなしで表示

### ビューポート設定
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
```

### ランドスケープ対応
- 横向き時もセーフエリアを考慮
- `env(safe-area-inset-left)` / `env(safe-area-inset-right)` でノッチ回避

---

## チェックリスト

新しいUIを作成する際の確認事項：

### 基本
- [ ] 画面端に20px以上の余白があるか
- [ ] 情報がカードで整理されているか
- [ ] 色は3色以内に収まっているか
- [ ] フォントサイズに優先順位があるか
- [ ] ボタンスタイルは統一されているか
- [ ] 選択状態が明確か

### タップターゲット（🍎 iOS必須）
- [ ] すべてのタップ可能要素が44×44px以上か
- [ ] 隣接するタップターゲット間に十分な間隔があるか
- [ ] 小さいアイコンにもパディングでタップ領域を確保しているか

### iOS Safari対応
- [ ] input/textareaのフォントサイズが16px以上か（自動ズーム防止）
- [ ] セーフエリア（ノッチ・角丸・ホームインジケーター）を考慮しているか
- [ ] `-webkit-appearance: none` でiOSデフォルトスタイルをリセットしているか
- [ ] 固定ヘッダー/フッターがセーフエリアを考慮しているか

---

## 参考リソース

- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [Designing Websites for iPhone X (WebKit)](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)
- [Touch Targets on Touchscreens (NN/g)](https://www.nngroup.com/articles/touch-target-size/)
- [Accessible tap targets (web.dev)](https://web.dev/articles/accessible-tap-targets)

---

**最終更新**: 2026-01-31
