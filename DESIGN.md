# デザインガイドライン

バドミントン練習管理アプリのUIデザイン統一ルール

---

## 🎨 デザインパターン

本アプリは **Card-based UI** と **Material Design** の原則を採用しています。

### Card-based UI（カードベースデザイン）

情報を視覚的に区切られた「カード」と呼ばれる矩形のコンテナに配置する手法です。
練習設定、試合入力、試合一覧といった各機能ブロックが白い背景の独立したカードとして表現されています。

**原則：**
- 関連する情報のまとまりを1つのカードに
- カードごとに明確な目的を持たせる
- カード間で視覚的な区切りを明確に

### Material Design の適用

Googleが発表したデザイン言語で、物理的な紙とインクの概念をデジタル空間に持ち込んだものです。

**適用している特徴：**
- 薄い色の背景に白いボックスを配置
- 影（shadow）で要素の階層を表現
- 丸みのある角（rounded corners）

### Flat Design 2.0

完全にフラットなデザインに、わずかな影やグラデーションを加えることで、視覚的な階層と使いやすさを両立させる手法です。

---

## 📐 Elevation（高度）システム

影の深さによって要素の重要度や階層を表現します。

| レベル | 用途 | Tailwind | 説明 |
|--------|------|----------|------|
| **Level 0** | 背景 | なし | ページ背景 |
| **Level 1** | カード | `shadow-md` | 通常のカード |
| **Level 2** | アクティブ/モーダル | `shadow-lg` | フォーカス状態、モーダル |
| **Level 3** | フローティング | `shadow-xl` | FAB、ドロップダウン |

**原則：** 高いレベルほどユーザーの注目を集める

---

## 📏 Spacing System（余白システム）

### 基本原則：8ポイントグリッドシステム

すべての余白は **8ピクセルを基本単位** とし、その倍数（8、12、16、24、32ピクセル）で設定します。
この数学的な規則性により、視覚的な調和とリズムが生まれます。

| 値 | Tailwind | 用途 |
|-----|----------|------|
| 8px | `p-2`, `gap-2`, `mb-2` | 密接に関連する要素間 |
| 12px | `p-3`, `gap-3` | 標準的な要素間 |
| 16px | `p-4`, `gap-4`, `mb-4` | 独立した要素間、コンテナパディング |
| 24px | `p-6`, `gap-6`, `mb-6` | カード内パディング、セクション間 |
| 32px | `p-8`, `gap-8`, `mb-8` | 大きなセクション間 |

### 階層的なスペーシング構造

外側から内側に向かって段階的に余白を設定する入れ子構造を採用します。

```
画面全体（16px パディング）
  └─ カード（24px パディング）
       └─ セクション間（16px 間隔）
            └─ ラベル↔入力（8px 間隔）
```

| 階層 | パディング/間隔 | Tailwind | 説明 |
|------|----------------|----------|------|
| **画面コンテナ** | 16px | `px-4`, `py-4` | 画面端とコンテンツの基本余裕 |
| **カード** | 24px | `p-6` | 独立した情報単位を強調 |
| **カード間** | 24px | `space-y-6` | セクション境界を明確化 |
| **フォーム項目間** | 16px | `space-y-4` | 各項目の独立性を表現 |
| **ラベル↔入力** | 8px | `mb-2` | 密接な関連を視覚的に表現 |

### 機能的なグルーピング

余白で要素のグループ化を表現します。

| グループ関係 | 間隔 | Tailwind | 例 |
|-------------|------|----------|-----|
| **同一グループ内** | 8px | `gap-2` | 選択ボタン群、関連アイコン |
| **異なるグループ間** | 16px以上 | `gap-4`〜 | 機能の異なるボタン群 |
| **ナビゲーション** | 12px | `p-3` | コンパクトに、領域を圧迫しない |

**原則：** 関係が近いものほど余白を狭く、遠いものほど広く

### 実装時の具体的な指針

#### 画面コンテナ
```css
max-w-md mx-auto px-4  /* 最大幅制限 + 左右16pxパディング */
```

#### カード要素
```css
p-6 rounded-xl shadow-md  /* 24pxパディング + 角丸 + 影 */
mb-6                       /* カード間24px間隔 */
```

#### フォーム
```css
space-y-4                  /* 入力項目間16px */
/* ラベル */
mb-2                       /* ラベル下8px */
/* アクションボタン */
mt-6                       /* フォーム末尾に24px以上の間隔 */
```

#### リスト項目
```css
space-y-2                  /* 項目間8-12px */
gap-2                      /* 項目内要素間8px */
```

### モバイル最適化

- ボタンには最低 `p-3`（12px）のパディングで44px以上のタップ領域確保
- 重要な操作要素の周囲には追加余白で誤操作防止
- 隣接要素との間隔は最低8px以上

---

## 🎨 Color Semantic（意味論的な色システム）

色に機能的な意味を持たせ、ユーザーが学習しやすい色の使い方を実践します。

| 色 | 意味 | Tailwind | 用途 |
|-----|------|----------|------|
| **Blue** | プライマリ/アクション | `blue-500` | メインボタン、選択状態、リンク |
| **Green** | 成功/追加/開始 | `green-500` | 追加ボタン、開始ボタン、成功メッセージ |
| **Orange** | 警告/終了 | `orange-500` | 終了ボタン、警告メッセージ |
| **Red** | 危険/削除 | `red-500` | 削除ボタン、リセット、エラー |
| **Gray** | 無効/セカンダリ | `gray-400/500` | 無効状態、補助ボタン、補足テキスト |

**原則：** 同じ意味には同じ色を一貫して使用

---

## 📱 Mobile-First Responsive Design

モバイルデバイスでの表示を最優先に設計し、必要に応じてデスクトップ向けに拡張します。

**原則：**
- タッチ操作に最適化されたボタンサイズ（44px以上）
- 片手操作を考慮した配置（重要なボタンは下部に）
- 条件付きスタイルで大画面に対応（`md:`, `lg:`）

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
- カード内パディング: `p-6`（24px）

---

## 3. カードデザイン

### 基本スタイル
```
bg-white rounded-2xl shadow-md p-6
```

> 📐 カード内パディングは24px（`p-6`）を標準とする（8ptグリッド準拠）

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

## 12. レイアウト安定性（Layout Stability）

**レイアウトジャンプ（CLS: Cumulative Layout Shift）を避ける**ことは、UXの重要な要素です。
コンテンツが突然動くと、ユーザーは意図しない場所をタップしたり、読んでいた場所を見失います。

### 基本原則

| ルール | 説明 | 実装方法 |
|--------|------|----------|
| **高さを事前に確保** | 動的コンテンツでも高さを固定/最小値を設定 | `min-height`, `h-[固定値]` |
| **flexで高さを揃える** | 並列要素の高さを自動で揃える | `items-stretch` + `flex` |
| **スペースを予約** | 表示/非表示が切り替わる要素用のスペース確保 | プレースホルダー, `invisible` |
| **アスペクト比を固定** | 画像・メディアの読み込み時のジャンプ防止 | `aspect-ratio`, `aspect-video` |

### 実装パターン

#### 1. 並列カードの高さを揃える（flex）
```jsx
{/* 親: items-stretch（デフォルト）で高さを揃える */}
<div className="flex items-stretch gap-4">
  {items.map(item => (
    {/* 子: flex + w-full で親の高さに追従 */}
    <div className="flex" style={{ width: '33%' }}>
      <Card className="flex flex-col w-full">
        {/* 可変コンテンツ部分を flex-1 で伸縮 */}
        <div className="flex-1">
          {content}
        </div>
        {/* 固定フッター */}
        <div>buttons</div>
      </Card>
    </div>
  ))}
</div>
```

#### 2. 動的コンテンツに最小高さを設定
```jsx
{/* コンテンツが空でも高さを確保 */}
<div className="min-h-[200px]">
  {hasContent ? <Content /> : <Placeholder />}
</div>
```

#### 3. 条件付き表示でスペースを確保
```jsx
{/* ❌ 悪い例: 表示時にレイアウトがジャンプ */}
{error && <ErrorMessage />}

{/* ✅ 良い例: スペースを常に確保 */}
<div className="min-h-[24px]">
  {error && <ErrorMessage />}
</div>

{/* ✅ 良い例: 見えないが場所は確保 */}
<div className={error ? '' : 'invisible'}>
  <ErrorMessage />
</div>
```

#### 4. スケルトンローディング
```jsx
{/* コンテンツと同じサイズのスケルトン */}
{isLoading ? (
  <div className="h-[180px] bg-gray-200 rounded-xl animate-pulse" />
) : (
  <ActualContent />
)}
```

### 避けるべきパターン

| パターン | 問題 | 代替案 |
|----------|------|--------|
| 条件付きで要素を追加/削除 | 周囲のレイアウトが動く | min-height確保、invisibleで隠す |
| 高さ未指定の動的リスト | 読み込み完了時にジャンプ | スケルトン、min-height |
| サイズ未指定の画像 | 読み込み完了時にジャンプ | width/height属性、aspect-ratio |
| フォント読み込み後のサイズ変化 | テキストが動く | font-display: swap + 同サイズのフォールバック |

### チェック方法

1. **Chrome DevTools** → Performance → "Layout Shift Regions" を有効化
2. **Lighthouse** → Core Web Vitals → CLS スコアを確認（0.1未満が良好）
3. **手動確認**: 状態変化時に周囲の要素が動かないか目視確認

---

## チェックリスト

### ⚠️ 実装時に必ず確認すること

以下のルールは**必須**です。違反している場合はデプロイ前に修正してください。

### 基本（余白・レイアウト）
- [ ] **画面端に16px以上の余白があるか** → `p-4`(16px)以上を使用（8ptグリッド準拠）
- [ ] ページのメインコンテナは `max-w-XXX mx-auto p-4` 以上
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

### レイアウト安定性
- [ ] **並列カードの高さは揃っているか** → `flex` + `items-stretch`
- [ ] **動的コンテンツに最小高さを設定しているか** → `min-h-[XXXpx]`
- [ ] **条件付き表示でレイアウトがジャンプしないか** → スペース予約、`invisible`
- [ ] 状態変化時に周囲の要素が動かないか目視確認

### アクセシビリティ
- [ ] コントラスト比4.5:1以上か
- [ ] フォーカス状態が見えるか
- [ ] アイコンボタンにaria-labelがあるか

### Tailwind早見表
| 目的 | 使うべき | 使わない |
|------|----------|----------|
| 画面端余白 | `p-4`(16px), `p-6`(24px) | `p-2`(8px)以下 |
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

**最終更新**: 2026-02-04
