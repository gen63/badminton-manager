# セッション自動アーカイブ: 最後の試合開始 + 3h に短縮

## 背景

`isSessionVisible` の上限は「**最初の**試合開始から **12h**」だった
(`firstMatchStartedAt` + `ARCHIVE_THRESHOLD_MS = 12h`)。
これだと

- 19:00-22:00 の練習 → 翌 07:00 まで一覧に残る
- 09:00-17:00 の練習 → 21:00 まで残る

と「最後の試合から長時間経っても見えたまま」になりやすく、終了済セッションが
ノイズになる。

ユーザー要望:
> 最後の試合開始から一定時間経過したセッションが一覧で見えたまま、
> 見えなくなる方が嬉しい。

## 方針

判定の基準点を **最初の試合 → 最後の試合** に変え、しきい値も
**12h → 3h** に短縮する。

| ケース | 旧 (first + 12h) | 新 (last + 3h) |
|--------|------------------|----------------|
| 19:00-22:00 | 翌 07:00 まで | **翌 01:00 まで** |
| 09:00-12:00 | 21:00 まで | **15:00 まで** |
| 単発 19:00 | 翌 07:00 まで | **22:00 まで** |

「片付け・会計の 30 分 + 帰宅後しばらく見える」程度の長さ。

### データの持ち方

旧実装は `firstMatchStartedAt` を Firestore に「保存」していたが、
これは `matchHistory` から純粋に計算できる派生値であり、保存する必然性が
ない。新実装では `lastMatchStartedAt` を **保存せず、`docToSession` で
`matchHistory` から都度算出** する。

メリット:

- マイグレーション不要（旧ドキュメントの `firstMatchStartedAt` フィールドは
  vestigial だが害もない）
- 書き込み箇所の重複定義 (`createSession` / `syncGameState` / `mutateGameState`)
  を 3 箇所削減できる
- `matchHistory` は `matchCount` の算出で既に読んでいるのでコスト微増のみ

## 変更内容

### `src/lib/sessionArchive.ts`
- `ARCHIVE_THRESHOLD_MS` を `12h → 3h` に変更
- `computeFirstMatchStartedAt` (`Math.min`) を
  `computeLastMatchStartedAt` (`Math.max`) にリネーム
- `isSessionVisible` の入力型を `firstMatchStartedAt` →
  `lastMatchStartedAt` に変更し、判定式の左辺も差し替え

### `src/types/session.ts`
- `Session.firstMatchStartedAt` → `Session.lastMatchStartedAt`

### `src/services/sessionService.ts`
- `docToSession` で `matchHistory` から `lastMatchStartedAt` を都度算出
- `createSession` / `syncGameState` の `firstMatchStartedAt` 書き込みを削除

### `src/services/sessionMutations.ts`
- `buildGameStatePayload` から `firstMatchStartedAt` 書き込みを削除
- 関連 import を削除

### テスト
- `sessionArchive.test.ts`: `computeLastMatchStartedAt` / 3h 境界 / 命名を更新
- `sessionMutations.test.ts`: `updateArgs.firstMatchStartedAt` の assertion を削除

## 影響範囲

- 直近のセッションが従来より早く一覧から消える（=狙い通り）
- Firestore に既にある `firstMatchStartedAt` 値は読まなくなるが残す（無害）
- 試合進行中（`lastMatchStartedAt` < 3h 前）のセッションは常に表示される
- 試合未開始のセッションは 90 分前ルール（前回 plan）で判定する
