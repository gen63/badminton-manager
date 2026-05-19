# シングルスモード配置アルゴリズムの改善

作成日: 2026-05-18
対応ブランチ: `claude/improve-match-pairing-PBbpp`

## 背景

`src/lib/algorithm.ts:1295` の `assignCourtsSingles` は現在、以下のグリーディ
方式で 1 コートずつペアを決めている。

1. ペアごとの過去対戦回数 `matchCountMap` を構築
2. 全員を優先度 (`gamesPlayed / 滞在分`) 昇順でソート
3. 上位 `requiredPlayers + 4` を候補に切り出し
4. 各コートで:
   - 1 人目: 候補の最優先プレイヤーを固定
   - 2 人目: 1 人目と最少対戦回数の相手を選出（タイブレークは優先度）

この方式は次の点でユーザー要望と乖離している。

| 要望 | 現状 |
|---|---|
| 総当たり優先 | ○ ただし「1 人目固定後のグリーディ」で全体最適化されない |
| 試合回数の差を抑える | △ 候補選出には効くがペア合算の均衡は未考慮 |
| 直前にプレイした人を避ける（連続回避） | × `lastPlayedAt` 未使用 |
| 大差ない時にレーティング近接ペア | × タイブレーク無し |

## 設計方針

**ペア単位のソフト重み付きコスト関数で全コートを同時に最適化する**。
1〜3 コートで候補プール ≤ 10 人を想定すれば、N 個の非重複ペアの全列挙でも
組合せ数は十分小さい（3 コート時で約 3,150 通り）。

### コスト関数

```ts
pairCost(a, b) =
    W_ROUNDROBIN * matchCount(a, b)              // 総当たり: 主軸
  + W_BALANCE   * (gamesPlayed(a) + gamesPlayed(b))  // 試合数均等
  + W_RECENCY   * recencyPenalty(a, b)           // 連続回避
  + W_RATING    * |rating(a) - rating(b)|        // レーティング近接（タイブレーク）
```

- `recencyPenalty(a, b)`:
  - `minRest = min(now - a.lastPlayedAt, now - b.lastPlayedAt)` (分)
  - `lastPlayedAt === 0`（未プレイ）の側は `Infinity` 扱いで 0 ペナルティ
  - `minRest < REST_THRESHOLD_MIN (=3)` なら
    `(REST_THRESHOLD_MIN - minRest) / REST_THRESHOLD_MIN` を返し、それ以外は 0
- 重みは「**連続回避** > 総当たり > 試合数均等 > レーティング」のソフト順序:
  - `W_RECENCY = 500` (最強。minRest=0 時の最大ペナルティ 500 で、
    実用範囲の RR 差 (~4 試合) と balance 差 (~60) を上回る)
  - `W_ROUNDROBIN = 100` (1 試合分の差で 100 のコスト差。
    recency が 0 になった後の主軸)
  - `W_BALANCE = 10` (1 プレイ加算で 10。recency と RR が拮抗した時に効く)
  - `W_RATING = 0.02` (100 pt 差で 2、タイブレーク程度)
- 5 分以上休めば recency ペナルティ 0 になり、それ以降は RR → balance →
  rating の順に効くため、休んでいる人達の中では従来通り総当たりが優先される

### 候補プール

現状を踏襲:

1. **最大偏差プレフィルタ** を追加: `gamesPlayed <= avgGames + 3` のみ
   （`assign2CourtsHolistic` と同等）。
   除外しすぎて必要人数を割ったらフォールバックで全員に戻す。
2. `calculatePriorityScore` 昇順でソートし `requiredPlayers + 4` 名を切り出し。
   `gamesPlayed === 0` は `-Infinity` で最上位にくるため初回保証は維持される。

### ペアリング選択

候補から **N 個の非重複ペア** を全列挙し、`pairCost` の合計が最小の組合せ
を採用する。同一最小コストの場合は早く見つかったほうを採用（候補が優先度順
で並んでいるため、優先度の高い人が前ペアに寄りやすい）。

```
function* enumeratePairings(candidates, n) {
  if (n === 0) yield []; return;
  const first = candidates[0];
  for (i = 1..candidates.length-1) {
    yield [[first, candidates[i]], ...enumeratePairings(rest, n-1)]
  }
}
```

### コート ID 割り当て

ペアは「候補リストの中で優先度が高いプレイヤーを含む順」で
`targetCourtIds` の若い順に割り当てる（現状の挙動と同じく、左から先のコート
ほど優先度の高いプレイヤーが入る）。

## 変更箇所

1. **`src/lib/algorithm.ts`**:
   - `assignCourtsSingles` を新アルゴリズムに置き換え
   - 重み定数とヘルパー (`computePairCost`, `enumeratePairings`,
     `pickBestPairing`) を内部関数として追加
2. **`src/lib/algorithm.test.ts`**:
   - 既存のシングルステストは無いので新規セクションを追加:
     1. 総当たり優先: 未対戦ペアが選ばれる
     2. 試合数均等: RR 同点時に gamesPlayed 合計が低いペアが選ばれる
     3. 連続回避: 直前 (5 分以内) にプレイした人がいるペアが避けられる
     4. レーティング近接: その他同点時に rating 差が小さいペアが選ばれる
     5. 多コート全体最適: グリーディだと損する組合せで全体最小が選ばれる
     6. gamesPlayed=0 初回保証: 必ず候補に含まれる
     7. 最大偏差フィルタ: 平均+3 超過は除外、ただし不足時は緩和

## 非対象

- 予約 (`Reservation`) 経由のシングルス配置 (`assignCourts` 内の
  `singlesReservationAssignments` 部分): 現状ロジックを維持
- ダブルスモードの配置ロジック: 一切変更しない
- `Player` / `Match` / `CourtAssignment` の型変更
