# 交換オーバーレイのレイヤリング修正

**日付**: 2026-02-05
**ブランチ**: `claude/fix-swap-overlay-layering-ADqEu`

## 問題

「○○ と交換したいプレイヤーをタップ」バーが通常のドキュメントフローに配置されており、表示時に下の要素（スコア未入力の試合など）を押し下げてしまう。

### 現状
- `MainPage.tsx:332-344` でバーは `space-y-6` コンテナ内の通常フロー要素
- 表示/非表示で下のコンテンツがガタつく（レイアウトシフト）
- スクリーンショットで確認：コートカードと「スコア未入力の試合」の間に割り込んでいる

## ゴール

- 交換バーを既存要素の**上に重なるように**表示する（要素を押し下げない）
- レイアウトシフトを発生させない

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

## 影響範囲

- `MainPage.tsx` のみ
- スタイル変更のみ、ロジック変更なし
- `ScoreInputPage.tsx` の同様のバーも同じ問題があるが、今回のスコープ外（必要に応じて別途対応）

## テスト

- `npm run build` でビルドエラーなし確認
- 交換バー表示時にレイアウトシフトが発生しないこと
- 交換バーが他の要素の上に重なること
- ×ボタンで閉じられること
- 交換操作が正常に動作すること
