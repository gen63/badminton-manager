# 休憩変更を「管理者 or 自分のみ」に制限

## 背景

現状、`MainPage` 上では誰でも任意のメンバーの `isResting` を切り替えられる。
誤操作・いたずらで他人を勝手に休憩入り／復帰させられる問題がある。

ユーザー要望:
> 休憩変更、管理者以上の権限持ち以外は自分の変更のみとしたい

= 管理者（creator / admin）は誰の休憩でも切替可、それ以外のメンバーは
**自分の名前と一致する Player の休憩だけ** 切替可とする。

## 信頼モデル前提（CLAUDE.md 参照）

本アプリは認証なし・知人グループ前提。`currentUser` は localStorage に
保存される名前文字列で、攻撃者は容易に詐称できる。本変更は **誤操作防止** の
UX ガードであって、セキュリティ境界ではない。サーバー側強制はない。

## 影響箇所

`src/pages/MainPage.tsx` のみ。`writer.toggleRest(playerId)` を呼ぶパスは 2 箇所:

1. `handleToggleRestWithLock(playerId)` (~line 391)
   - 待機中カードの ☕ アイコンクリック → 休憩入り
2. `handlePlayerTap(playerId, ...)` (~line 435) の「resting 分岐」内、
   コート選択なしで resting カードをタップした「復帰」パス (~line 451)

`handlePlayerTap` の **swap 分岐** (court 上のメンバー選択中に resting カードを
タップ) は「コート操作」の意味合いが強く、本 PR のスコープ外として触らない。
（コート操作の権限ガードは別途整理する余地あり）

## 設計

### ヘルパー (MainPage 内に inline)

```ts
const canToggleBreak = useCallback(
  (playerName: string): boolean => {
    if (isAdmin()) return true;
    return !!currentUser && currentUser === playerName;
  },
  [isAdmin, currentUser]
);
```

- `isAdmin()` は既に「ローカルモード」「dev モード」で true を返すため、
  オフライン運用や開発時は実質ノーガード（既存仕様を踏襲）。

### ハンドラーガード

`handleToggleRestWithLock` 冒頭で:

```ts
const player = players.find(p => p.id === playerId);
if (!player) return;
if (!canToggleBreak(player.name)) {
  toast.warning('他のメンバーの休憩は管理者のみ変更できます');
  return;
}
```

`handlePlayerTap` の `else { void writer.toggleRest(playerId); ... }` 直前にも
同じチェック → 不可なら toast + 選択解除して return。

### UI（誤操作減らし）

待機中カードの ☕ アイコンは `canToggleBreak(player.name)` が true の場合のみ
レンダリングする。タップ可能な見た目を出さないことで、ユーザーに「自分の
カードしか操作できない」ことを暗示する。

休憩中カードは「タップ＝復帰 or 交換」の二義のため、見た目は維持し、
タップ時のハンドラーで toast フィードバックを出す方針とする。

## 非対応 / 将来検討

- コート上のメンバー入れ替え (`handleSwapPlayer`) の権限制御。
- Firestore Security Rules によるサーバー強制（CLAUDE.md の信頼モデル方針）。
- `currentUser` を player.id に紐付ける本格的なオーナーシップ。

## チェック

- `npm run build`
- `npm run lint`
- `npm run test:run`
