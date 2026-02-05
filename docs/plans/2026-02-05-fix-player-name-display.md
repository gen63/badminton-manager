# コートカード内プレイヤー名表示の改善

**作成日**: 2026-02-05
**ステータス**: 実装中

---

## 1. 現状の課題

### 1.1 プレイヤー名のフォントが小さすぎる

現在の `.player-name-court` は `clamp(0.625rem, 2.5vw, 0.75rem)` (10px〜12px) で、
375px幅端末では10pxまで縮小してしまい視認性が低い。

### 1.2 試合数の位置が名前の長さに依存する

試合数（数字）がプレイヤー名の直後に配置されているため、
名前の長さによって数字の位置がバラバラになり、一覧性が悪い。

### 1.3 試合数の色が名前と近い

試合数が `text-gray-500` で名前（`text-gray-800`）と視覚的に近く、
補助情報として控えめに見えない。

---

## 2. 修正内容

### 2.1 フォントサイズの引き上げ

```css
/* 変更前 */
.player-name-court {
  font-size: clamp(0.625rem, 2.5vw, 0.75rem);  /* 10px〜12px */
}

/* 変更後 */
.player-name-court {
  font-size: clamp(0.75rem, 3.2vw, 0.875rem);  /* 12px〜14px */
}
```

- 最小サイズを10px→12pxに引き上げ（可読性の大幅改善）
- 最大サイズを12px→14pxに引き上げ
- 3.2vwで375px端末時 12px、437px端末時 14px

### 2.2 試合数を右端固定

PlayerPill コンポーネント内の名前+試合数を包む `<span>` に `flex-1` を追加し、
ピル全幅を使い切るようにする。これにより試合数は常に右端に配置される。

```tsx
// 変更前
<span className="text-gray-800 font-medium flex items-center min-w-0 overflow-hidden">

// 変更後
<span className="text-gray-800 font-medium flex items-center min-w-0 overflow-hidden flex-1">
```

### 2.3 試合数の色を薄く

```tsx
// 変更前
<span className="text-[10px] text-gray-500 ...">

// 変更後
<span className="text-[10px] text-gray-400 ...">
```

`text-gray-500` → `text-gray-400` で補助情報としてより控えめに。

---

## 3. 影響範囲

- `src/index.css`: `.player-name-court` の clamp 値変更
- `src/components/CourtCard.tsx`: PlayerPill 内のクラス変更

---

## 4. リスク

- フォントを大きくすると長い名前が省略される可能性が高まるが、
  `text-overflow: ellipsis` で対応済み
- 試合数を右端に固定することでピル内の空白が増えるが、
  視認性・一覧性が向上するトレードオフ
