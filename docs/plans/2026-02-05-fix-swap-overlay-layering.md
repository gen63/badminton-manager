# 交換オーバーレイのレイヤリング修正 + プレイヤー名Shrink-to-fit

**日付**: 2026-02-05
**ブランチ**: `claude/fix-swap-overlay-layering-ADqEu`

## 問題

### 問題1: 交換バーのレイアウトシフト
「○○ と交換したいプレイヤーをタップ」バーが通常のドキュメントフローに配置されており、表示時に下の要素（スコア未入力の試合など）を押し下げてしまう。

### 現状
- `MainPage.tsx:332-344` でバーは `space-y-6` コンテナ内の通常フロー要素
- 表示/非表示で下のコンテンツがガタつく（レイアウトシフト）
- スクリーンショットで確認：コートカードと「スコア未入力の試合」の間に割り込んでいる

### 問題2: 長い名前のプレイヤーで折り返し/省略が発生
エクセルの「縮小して全体表示」のように、名前の長さに応じてフォントサイズを自動縮小したい。

### 現状
- `index.css:270-275` の `.player-name-court` は `clamp(0.625rem, 2.5vw, 0.75rem)` でビューポート幅に連動するだけ。名前の長さは考慮しない
- `text-overflow: ellipsis` で長い名前は `...` で切られる
- MainPage参加者一覧（`MainPage.tsx:422`）は `text-sm` 固定で、overflow-hidden はあるが shrink なし
- MainPage休憩中（`MainPage.tsx:506`）は `text-sm` 固定で、overflow 対策なし

#### プレイヤー名が表示される箇所（3箇所）
1. **CourtCard内**（`CourtCard.tsx:51`）: `.player-name-court` クラス使用
2. **参加者一覧**（`MainPage.tsx:422`）: `text-sm` + `overflow-hidden`
3. **休憩中一覧**（`MainPage.tsx:506`）: `text-sm` のみ

## ゴール

- 交換バーを既存要素の**上に重なるように**表示する（要素を押し下げない）
- レイアウトシフトを発生させない
- 長い名前のプレイヤーが**折り返し・省略なし**で、フォントサイズ縮小により全体表示される

## 修正方針

### アプローチ: `fixed` bottom バー

交換バーを画面下部に固定表示（`fixed bottom-0`）する。

**理由**:
- プレイヤーはコート内・参加者一覧のどちらもタップする可能性があるため、画面内の特定位置よりも常に見える場所が適切
- スマホ操作で画面下部は親指の届きやすいゾーン
- 既存レイアウトに一切影響しない

### 変更箇所

#### 1. `src/pages/MainPage.tsx` (L332-344)

**Before**:
```tsx
{selectedPlayer && (
  <div className="bg-gradient-to-r from-indigo-50 to-indigo-50 border-2 border-indigo-200 rounded-xl p-4 text-sm text-indigo-700 flex items-center justify-between shadow-sm">
    ...
  </div>
)}
```

**After**:
```tsx
{selectedPlayer && (
  <div className="fixed bottom-4 left-4 right-4 z-40 bg-white border-2 border-indigo-300 rounded-xl p-4 text-sm text-indigo-700 flex items-center justify-between shadow-lg max-w-6xl mx-auto">
    ...
  </div>
)}
```

変更点:
- `fixed bottom-4 left-4 right-4`: 画面下部に固定、左右に余白
- `z-40`: 他の要素より上に表示（モーダル `z-50` よりは下）
- `shadow-lg`: 浮遊感を強調するため影を大きく
- `bg-white`: 背景を白にして下の要素との区別を明確に
- `max-w-6xl mx-auto`: 親コンテナと同じ最大幅を維持
- `space-y-6` コンテナ内から外に移動して、レイアウトフローから除外

#### 2. 配置位置の移動

`space-y-6` コンテナ内 → コンテナ外（`pb-20` のルートdiv直下）に移動。
これにより `space-y-6` のマージン影響を受けなくなる。

---

### アプローチ2: プレイヤー名 Shrink-to-fit

CSSだけでは「文字列の長さに応じた自動縮小」は実現できないため、
`ShrinkText` コンポーネントを作成してJavaScriptで動的にスケーリングする。

#### 仕組み

1. `useRef` でテキスト要素を参照
2. `useLayoutEffect` で `scrollWidth`（テキスト本来の幅）と `clientWidth`（コンテナ幅）を比較
3. はみ出している場合、`transform: scaleX(clientWidth / scrollWidth)` で水平方向に縮小
4. `transform-origin: left` で左揃え維持

```tsx
// src/components/ShrinkText.tsx
function ShrinkText({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // リセット
    el.style.transform = '';
    const ratio = el.clientWidth / el.scrollWidth;
    if (ratio < 1) {
      el.style.transform = `scaleX(${ratio})`;
    }
  });

  return (
    <span
      ref={ref}
      className={className}
      style={{ display: 'inline-block', whiteSpace: 'nowrap', transformOrigin: 'left center' }}
    >
      {children}
    </span>
  );
}
```

**メリット**:
- エクセルと同等の挙動（コンテナ幅に収まるよう文字幅を自動縮小）
- 名前は省略(`...`)されず全体が見える
- 再利用可能なコンポーネント

**`scaleX` vs `fontSize` 調整**:
- `scaleX`: DOMリフローが発生しない、パフォーマンス良好、実装シンプル
- `fontSize`: リフロー発生、ループ計算が必要、ただし見た目が自然
- → `scaleX` を採用。極端に長い名前でなければ見た目の違いは軽微

#### 変更箇所

##### 3. `src/components/ShrinkText.tsx` (新規)

上記コンポーネントを作成。

##### 4. `src/components/CourtCard.tsx` (L51)

**Before**:
```tsx
<span className="player-name-court flex-1 min-w-0">{name}</span>
```

**After**:
```tsx
<ShrinkText className="player-name-court flex-1 min-w-0">{name}</ShrinkText>
```

##### 5. `src/pages/MainPage.tsx` - 参加者一覧 (L422)

**Before**:
```tsx
<span className="flex-1 min-w-0">{player.name}</span>
```

**After**:
```tsx
<ShrinkText className="flex-1 min-w-0">{player.name}</ShrinkText>
```

##### 6. `src/pages/MainPage.tsx` - 休憩中一覧 (L506)

**Before**:
```tsx
<span className="text-gray-700 text-sm">{player.name}</span>
```

**After**:
```tsx
<span className="text-gray-700 text-sm flex items-center min-w-0 overflow-hidden">
  <ShrinkText className="flex-1 min-w-0">{player.name}</ShrinkText>
  ...
</span>
```

##### 7. `src/index.css` - `.player-name-court` (L270-275)

`text-overflow: ellipsis` を削除（ShrinkTextが縮小表示するため不要）。

**Before**:
```css
.player-name-court {
  font-size: clamp(0.625rem, 2.5vw, 0.75rem);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

**After**:
```css
.player-name-court {
  font-size: clamp(0.625rem, 2.5vw, 0.75rem);
  overflow: hidden;
}
```

`white-space: nowrap` と `text-overflow: ellipsis` は `ShrinkText` のインラインスタイルで制御するため削除。

## 影響範囲

- `MainPage.tsx`: 交換バーの位置変更 + ShrinkText適用
- `CourtCard.tsx`: ShrinkText適用
- `ShrinkText.tsx`: 新規コンポーネント
- `index.css`: `.player-name-court` のellipsis削除
- ロジック変更なし（表示のみの変更）

## テスト

- `npm run build` でビルドエラーなし確認
- 交換バー表示時にレイアウトシフトが発生しないこと
- 交換バーが他の要素の上に重なること
- ×ボタンで閉じられること
- 交換操作が正常に動作すること
- 長い名前（例: 10文字以上）のプレイヤーが折り返し・省略なしで表示されること
- 短い名前のプレイヤーのフォントサイズが変わらないこと
