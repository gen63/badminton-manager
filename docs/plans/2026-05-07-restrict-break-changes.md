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

`src/pages/MainPage.tsx` のみ。`isResting` を変更しうる UI からのパスは 3 箇所:

1. `handleToggleRestWithLock(playerId)` — 待機中カードの ☕ アイコンクリック
   → 休憩入り (`writer.toggleRest`)
2. `handlePlayerTap(playerId, ...)` の「resting 分岐」内、コート選択なしで
   resting カードをタップした「復帰」パス (`writer.toggleRest`)
3. `handlePlayerTap` の **swap 分岐** — コート上のメンバー選択中に resting
   カードをタップ → `writer.swapPlayer` 経由で対象プレイヤーの
   `isResting: true → false`（CON2 のアトミック swap で休憩解除を伴う）

3 つ全てにガードを入れる。3 を放置すると非管理者が「適当なコート上の人を
選択 → 他人の休憩カードをタップ」で他人を勝手に試合復帰させる抜け道が
残るため、本 PR ではスコープに含める。

なお SettingsPage の「試合をリセット」(`writer.setAllPlayersResting`) は
既に admin-only ページのため対応不要。`autoAssignAndFulfill` /
`swapPositions` などコート操作系で `isResting` を変えないものは対象外。

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

`handlePlayerTap` の `if (player?.isResting)` ブロック先頭で同じチェック →
不可なら toast + 選択解除して return（swap 分岐 / 復帰分岐の両方を一度に
ガードできる）。

### UI（誤操作減らし）

待機中カードの ☕ アイコンは `canToggleBreak(player.name)` が true の場合のみ
レンダリングする。タップ可能な見た目を出さないことで、ユーザーに「自分の
カードしか操作できない」ことを暗示する。

休憩中カードは「タップ＝復帰 or 交換」の二義のため、見た目は維持し、
タップ時のハンドラーで toast フィードバックを出す方針とする。

## 非対応 / 将来検討

- コート ↔ コート、コート ↔ 待機 の swap (`isResting` を変えないもの) の
  権限制御。コート操作全般の権限は別軸で整理する余地あり。
- Firestore Security Rules によるサーバー強制（CLAUDE.md の信頼モデル方針）。
- `currentUser` を player.id に紐付ける本格的なオーナーシップ
  （現状は名前文字列の完全一致比較）。
- 同名プレイヤーが複数いる場合、両方とも「自分」として扱われる。
  既存の権限モデル（`session.createdBy === currentUser`）と同じ前提。

## チェック

- `npm run build`
- `npm run lint`
- `npm run test:run`
