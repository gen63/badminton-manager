# ペア内の名前並び順を一定にする

**作成日**: 2026-04-25
**ステータス**: 実装中

---

## 1. 現状の課題

履歴ページ等で「ABvsCD」表示の際に、勝ちペアが左に来る仕様はあるが、
**ペア内の並び（AB か BA か）は不定**。

原因:
- `Match.teamA: [string, string]` / `teamB: [string, string]` は配列の格納順がそのまま表示順になっている
- `algorithm.ts#formTeams()` は `teamA = [rank1, rank4]`, `teamB = [rank2, rank3]` と組み合わせる
  ため、teamA は「強い+弱い」、teamB は「中間2人」の順で固定的に並ぶ
- ただし、性別バランスのため一部経路で並びが入れ替わる可能性があり、また将来の変更で順序が
  保証されない

そのため、同じ4人のペアでも試合によって並びが変わって見えることがある。

## 2. 方針

### 2.1 並び順の基準

**強さ順**で揃える。具体的には:
1. `Player.rating` の降順（高レーティング = 強い）
2. 同レーティングの場合は `Player.name` の `localeCompare('ja')` 昇順
3. 該当プレイヤーが見つからない場合は最弱として末尾扱い

ストリーク調整 (`applyStreakSwaps`) は含めない。理由:
- 表示の安定性を優先（試合ごとに並びが変わらない）
- レーティングが本来の強さ指標

### 2.2 実装場所

**データモデルは変更しない**。`Match.teamA / teamB` の格納順はそのまま、
**表示直前にソート**する。これにより:
- 既存データとの互換性が保たれる
- 並び基準を後で変更したい場合も影響範囲が局所的
- アルゴリズム側の `formTeams` 結果に依存しない

### 2.3 共通ユーティリティ

`src/lib/utils.ts` に追加:

```typescript
// 表示用：並び替え後のIDのみ
export function sortPairByStrength(
  pair: readonly [string, string],
  players: readonly Player[]
): [string, string]

// クリック操作用：表示順に並び替えた上で元のインデックスも保持
export function sortPairWithIndex(
  pair: readonly [string, string],
  players: readonly Player[]
): Array<{ id: string; index: 0 | 1 }>
```

`sortPairWithIndex` を用いるのは以下のケース:
- `CourtCard` / `MainPage` のコート上選手ボタン: タップで `position`（0-3）を渡して入れ替え
- `ScoreInputPage` の対戦カード: 同様に `position` を使った入れ替え

これらは「表示順は強さ順、しかしクリック時は元の配列インデックスを渡す」ことが必要なため、
インデックス情報を保持できるユーティリティが要る。

## 3. 適用範囲

### 表示箇所（Pair 単位で並び替えが必要）

| 場所 | ファイル | 備考 |
| --- | --- | --- |
| 履歴ページ 名前表示 | `src/pages/HistoryPage.tsx` | leftTeam / rightTeam |
| 履歴ページ CSVコピー | `src/pages/HistoryPage.tsx` | a1/a2/b1/b2 列 |
| コートカード（試合中） | `src/components/CourtCard.tsx` | PlayerPill 並び |
| メインページ コートグリッド | `src/pages/MainPage.tsx` | 試合中の選手列 |
| スコア入力モーダル | `src/components/ScoreInputModal.tsx` | ヘッダー名前 |
| スコア入力ページ | `src/pages/ScoreInputPage.tsx` | チーム表示 |
| 勝者選択モーダル | `src/components/WinnerSelectModal.tsx` | ペア表示 |
| 選手交換モーダル | `src/components/PlayerSwapModal.tsx` | 4人グリッド |
| 通知メッセージ | `src/lib/notifications.ts` | 受け取り側で対応 |
| Sheets エクスポート | `src/lib/sheetsApi.ts` | チーム送信 |

## 4. 注意点

- **データは変更しない** — 並び替えは表示時の派生のみ。`Match.teamA[0]/[1]` の意味（本来の格納）は維持。
- **シングルス対応** — `teamA[1] === ''` のケースで `''` を末尾に保つ（rating ルックアップ失敗扱い）。
- **パフォーマンス** — 履歴ページは試合数分ループするため、`useMemo` で `players` をマップ化してから渡す。

## 5. テスト

ユニットテストを `src/lib/__tests__/utils.test.ts`（既存があれば追記、なければ作成）に追加:
- 強い→弱いの順に並ぶ
- 同レーティング時は名前昇順
- 不明なIDは末尾
- シングルス（`['x', '']`）は元のままを返す（要件としては `''` を末尾）

## 6. リリース後の確認

- 履歴ページで複数試合を見て、同じペアが常に同じ並びで表示されること
- 試合中のコート表示でも左に強い選手が来ること
- スコア入力画面、編集画面でも同様
