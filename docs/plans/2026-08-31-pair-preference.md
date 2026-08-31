# ペア希望（Pair Preference） — 特定の2人が組む確率を上げる

## 背景と要求

「この2人は先々の試合でペアを組む可能性がある。**毎回必ず一緒ではないが、組む確率を
高くしたい**」という運用要求。既存の予約機能（`Reservation`）は「次の1試合を確定させる
ハード・使い捨て」なので、この要求には合わない。

| 案 | なぜ足りないか |
|---|---|
| 予約機能を毎回使う | 手動で毎回押す運用になり、「必ず一緒ではない」も表現できない |
| `variety` の重みを下げる | 全員に効いてしまい、特定2人だけを優遇できない |

## 現状の確認（実装済みの前提）

配置エンジンは `src/lib/pairing/`（`assignRound.ts` + `objective.ts`）の目的関数ベース。
**ハード制約（`violations`）→ 6目的の重み付き合計 → 最急降下（乱数なし・決定的）**。

重要な既存事実:

- **同じ2人が繰り返し組むことを禁じるハード制約は無い。** 直近重複判定
  `hasSimilarRecentMatch` は `RECENT_MATCH_OVERLAP_LIMIT = 3` なので、4人中3人以上が
  同じときだけブロックする。2人固定で残り2人が変われば毎試合でも制約は通る
  （`algorithm.ts:363`）
- 同じペアの繰り返しを抑えているのは目的6 `variety`（重み 2.6、共演回数の累積
  ペナルティ）**だけ** = ソフト制約

つまり「ペアになる確率を上げる」は、`variety` に対抗する項を1つ足すだけで実現できる。

---

## 設計

### 1. データモデル

`src/types/pairPreference.ts`（新規）:

```ts
export interface PairPreference {
  id: string;
  playerIds: [string, string];   // 常に2人。3人以上は扱わない
  /** 目標成立比率。0.35 = ひかえめ / 0.6 = 積極的（UI は2段階） */
  targetRatio: number;
  createdAt: number;
  createdBy?: string;
}
```

`GameState`（`src/services/sessionService.ts`）に **optional** で追加する。旧セッション
ドキュメントには存在しないため `?` 必須。

```ts
export interface GameState {
  players: Player[];
  courts: Court[];
  matchHistory: Match[];
  reservations: Reservation[];
  pairPreferences?: PairPreference[];   // ← 追加
  settings?: SyncSettings;
}
```

**予約と決定的に違う点 — 副作用を持たせないこと。**
`computeAddReservation` は予約に入れたメンバーを `isResting: true` にする副作用を持つ
（`sessionMutations.ts:836` 付近）。**ペア希望はこれを絶対に真似しない。** 希望は
恒常的な設定であり、登録した瞬間に2人が待機から外れたら本末転倒になる。
`computeAddPairPreference` / `computeRemovePairPreference` は `pairPreferences` 配列
だけを触る純粋な追加・削除にする。

また `status` / `fulfilledAt` を持たない（消化されない）。セッション中ずっと残る。

### 2. 「確率を上げる」の表現方法 ← 設計の肝

このエンジンは**乱数を持たない決定的な最急降下**（`2026-07-28-deterministic-court-noise.md`
で再現性を確保済み）。したがって「50% の確率で組ませる」は乱数ではなく**飽和**で表現する。

```
実績   actual      = pairCounts.partner.get(pairKey(a, b))     … 味方だった回数
機会   opportunity = min(gamesPlayed_a, gamesPlayed_b)          … 組み得た試合数の上限
達成度 achieved    = actual / max(1, opportunity)
不足度 deficit     = clamp01((targetRatio − achieved) / targetRatio)
```

- `deficit > 0`（目標を下回っている）ときだけペナルティが立つ
- 目標に達したら項が 0 になり、以降は `variety` が普通に効いて自然に散る
- 散った結果また目標を下回れば再び立つ

**この振動そのものが「必ず一緒ではないが、およそ targetRatio の頻度で組む」を作る。**
固定ボーナス方式だと、他目的との綱引き次第で「毎回一緒」か「ほぼ効かない」の二値に
振れるため採らない。`deficit` を 0/1 の二値にせず不足度でスケールさせるのは、目標に
近づくほど他の目的（実力・性別）に譲らせるため。

`opportunity` に `min(gamesPlayed)` を使うのは、**新たな永続カウンタを持たずに
既存状態だけで導出できる**ため。「2人が同時に候補プールにいたラウンド数」を正確に
数えるには専用カウンタの永続化が要り、同期・巻き戻りの整合を持ち込むので採らない。
`min(gamesPlayed)` は機会をやや過大評価する（別コートで同時に試合していた分を
機会に数える）が、その方向のズレは**達成度を低く見積もる = 希望が長く効く**側なので、
`targetRatio` の実効値として bench で吸収できる。

### 3. 目的関数への追加（`objective.ts`）

第7項 `affinity` を追加する。**0〜1・小さいほど良い**は他項と共通。

```
評価対象 = 「両者がこのラウンドの候補プールにいる」希望ペアのみ
           （片方が試合中・休憩中なら分母から外す）

ペアごとの寄与:
  味方（同コートで partner）  → 0
  同コートで敵                → 0.5
  別コート / 片方以上がベンチ → 1.0

affinity = Σ(deficit × 寄与) ÷ 評価対象ペア数     （対象0件なら 0）
```

実現不可能な希望を分母から外すのは、**それを定数ペナルティとして残すと他の目的に
対する重み比が意図せず薄まる**ため（全項が 0〜1 に正規化されている前提が崩れる）。

`objective.ts` は外部依存を持たない方針なので、`deficit` の算出は `algorithm.ts` 側で
行い、`ObjectiveInput` には**計算済みの値だけ**を渡す:

```ts
/** pairKey → deficit（0〜1）。0 または未登録のペアは対象外 */
affinityDeficitByPairKey: Map<string, number>;
```

### 3b. 試合機会への影響（入りやすくなる／公平性のリークとガード）

`affinity` の寄与は「味方 = 0 / 同コートで敵 = 0.5 / **別コートかベンチ = 1.0**」なので、
2人を**同時にコート上へ押し出す力**として働く。結果、**ペア希望を登録した人は
試合に入りやすくなる**（特に、片方が先に待っている状況では遅れている方が
引っ張り込まれる）。

- **行列は飛べない。** 公平性の窓（`FAIRNESS_WINDOW_RATIO`）はハード制約なので、
  順番がまだ来ていない人を希望のために引き上げることはできない
- **相手が不在のラウンドは中立。** 「両者が候補プールにいる希望ペアだけを評価対象に
  する」設計のおかげで、**相手が試合中だから自分も入れない、は起きない**。分母除外は
  重み比を守るための措置だが、副次的にこの性質も担保している

**公平性のリークとそのガード。** コートの枠は増えないので、希望ペアが優遇された分だけ
他の人が押し出される。試合数が増えれば優先度順位が下がるという自己修正は効くが、
均衡点はわずかにプラス側へ寄る。これを止めるため、**既存の
`reservationBlockThreshold`（`DEFAULT_RESERVATION_BLOCK_THRESHOLD = 2`）と同じガードを
`affinity` にも適用する**:

```
どちらかの gamesPlayed − 中央値 >= reservationBlockThreshold  →  deficit = 0
```

予約で既に使われている仕組み・語彙をそのまま流用するので、設定項目を増やさずに済み、
運用上の説明も「予約と同じ基準で保留されます」で済む。中央値の算出は
`2026-08-13-in-progress-games-in-fairness.md` の母集団（配置済みコート上のメンバーを
`gamesPlayed + 1` として数える）に合わせる。

### 3c. 希望の組数による効き方の違い

`affinity` は評価対象ペア数で**平均**するため、組数で2方向に変わる。

| 観点 | 1組だけ | N組 |
|---|---|---|
| 配置全体への総影響量 | 一定 | **一定**（平均＝予算制。10組でも壊れない） |
| 1組あたりの効き目 | 最大 | **1/N に薄まる**（6組では `targetRatio` に届かない） |
| 公平性の偏り | **最大**（22人中2人だけが得） | 小（全員が持てば差は消える） |

**実用上の推奨は1〜3組**。UI で組数を制限はしないが、bench は **N = 1 / 3 / 6** で測り、
1組（効き目最大・偏り最大）と6組（薄まりすぎ）の両端を押さえる。重みを1組の
最悪ケースで決める必要があるのは 6.（重みの決め方）に記載のとおり。

### 4. 実装上の落とし穴 — `splitCost` にも入れる（必ず踏む）

`assignRound.ts` の `normalizeSplit` は「4人をどう2対2に割るか」を
**`competitive` + `mixSplit` の2項だけ**で決めており、探索状態は「誰がどのコートか」しか
持たない（`assignRound.ts:379` 付近のコメント参照）。

目的関数側にだけ `affinity` を足すと、**2人を同じコートに集めるところまでは効くが、
味方にならず敵同士になる**という中途半端な結果になる。`splitCost` にも同じ項を足すこと:

```ts
// splitCost 内: そのコートに両者がいる希望ペアについて、敵同士なら 0.5 分を課す
const affinity = /* Σ deficit × (味方なら 0 / 敵なら 0.5) / activePairCount */;
return competitive + mixSplit + affinity * weights.affinity;
```

**スケールの注意**: `splitCost` は「コート1面ぶんの未平均コスト」だが、`computeAffinity`
は**コート数ではなく評価対象ペア数**で割っている。他項（`competitive`）とは分母が違う
ので、`affinity: 1.0` は他項の 1.0 と同じ強さを意味しない。重みは必ず bench で決める。

### 5. ハード制約との関係（安全側に倒れる）

`violations` は `compareEval` の辞書式比較で目的関数より先に評価されるため
（`assignRound.ts:149`）、希望ペアが以下を破ることは**構造上あり得ない**:

- 順位差のハード制約（`wideSpanThreshold`）→ 実力が離れすぎた2人の希望は成立しない
- 直近重複（`hasSimilarRecentMatch`）→ 同じ4人の繰り返しにはならない
- 公平性の窓（`FAIRNESS_WINDOW_RATIO`）→ 片方だけ待機順が来ている場合は成立しない

これは正しい優先順位（公平性・実力分離 > 希望）だが、**「登録したのに全然組めない」が
起こり得る**。UI に成立実績を出して納得感を担保する（後述）。

**希望ペアのために制約を緩める分岐は作らない。** 実力差の大きい2人を無理に組ませる
のは `skillGap` を上げた 2026-08-05 以降の設計方針（帯を崩さない）に正面から反する。

#### 実際にどれくらい厳しいか（実運用ではほぼ当たらない）

`wideSpanThreshold = ceil(ロースター人数 × 2/3)`、`WIDE_RANK_SPAN_MIN_ROSTER = 14`。

**このサークルの実運用レンジは 3コート最大25人・通常22人**なので、その範囲で見る。

| 人数 | ハード制約（組めない） | 1グループ幅 | 成立しにくくなる目安 |
|---|---|---|---|
| 〜13人 | **なし**（制約オフ） | 4人 | 順位差 4以上 |
| 14人 | 順位差10以上（1位×11位〜） | 5人 | 順位差 5以上 |
| 16人 | 順位差11以上（1位×12位〜） | 6人 | 順位差 6以上 |
| 18人 | 順位差12以上（1位×13位〜） | 6人 | 順位差 6以上 |
| 20人 | 順位差14以上（1位×15位〜） | 7人 | 順位差 7以上 |
| **22人（通常最大）** | 順位差15以上（1位×16位〜） | 8人 | 順位差 8以上 |
| **25人（上限）** | 順位差17以上（1位×18位〜） | 9人 | 順位差 9以上 |

**通常最大の22人でも、ブロックされるのは「1位 × 16位以降」だけ。** 実運用で
「実力差でペア希望が成立しない」はまず起きないと考えてよい。なお制約は
**コート4人全体の順位幅**で判定するが、4人の幅 ≥ ペアの順位差なので
「ペアの順位差が閾値以上なら必ず違反」が成り立つ。レート未設定（全員 0）だと
`buildRanksWithTies` で全員同順位になり、制約は一切効かない。

**実務上効くのは断崖ではなく手前の連続的な効きにくさ。** 2人を同じコートに入れると
残り2人もその実力帯に押し込まれるため `skillGap`（重み 1.5）のペナルティが増える。
22人で順位差12のペアなら `skillGap` は通常の約3倍になり、`affinity` がそれを
上回らないと成立しない。つまり「閾値未満なら OK / 以上なら NG」の二値ではなく、
**離れているほど成立頻度が落ちて `targetRatio` に届かなくなる**。UI の成立実績表示は
ここで効く。

上表の「1グループ幅」= `ceil(人数 / 3)` は、旧エンジンの3分割（upper/middle/lower）
1つ分に相当する。**順位差がこれ以上ある = 実力帯を跨いでいる**ということなので、
UI の警告はハード制約ではなくこの線で出す（後述）。

### 6. 重み `affinity` の決め方

既存の重みは全て bench で決定している（`objective.ts` の `DEFAULT_WEIGHTS` コメント）。
`affinity` も同様に `scripts/bench-court-assignment.ts` で決める。

- bench に「希望ペアを N 組ランダムに登録する」条件を追加し、
  **希望ペア成立率（実績/機会）**を新規指標として出力する
- 条件は既定（`13x2,14x2,16x2,15x3,18x3,21x3`）に **`22x3`（通常最大）と
  `25x3`（上限）を追加**する。それ以上の人数は運用上あり得ないので測らない
- 既存指標の悪化を同時に見る: 幅広% / 3-1% / 競り度 / 占有率 / 試合数幅
- **公平性リークの専用指標を足す**: 「希望ペア当事者の試合数 − 全体中央値」。
  3b のガードが効いていれば 0 付近に収まるはず。ここが +1 を超えるようなら
  「ペア希望を登録すると試合が増える」ことになり、運用上受け入れられない
- 希望の組数は **N = 1 / 3 / 6** を振る（3c 参照）
- 開始点は `gender`（1.6）と同程度、`variety`（2.6）より弱く。0.8 / 1.2 / 1.6 / 2.0 を振る
- **希望ペア1組の条件を必ず入れる。** `affinity` は評価対象ペア数で平均するため、
  1組しか登録されていないと分母1でその1組が**最大強度**になる（10組あれば互いに
  薄まる）。意味としては妥当（1組しか希望していないなら尊重されるべき）だが、
  **重みは「1組だけ」の最悪ケースで決めないと `skillGap` を押し切って
  実力差の大きいペアを無理に成立させてしまう**
- **合格条件**: N=1〜3 で成立率が `targetRatio` の ±0.1 に収まり、既存指標の悪化が
  試合数幅 +0.1 未満・3-1% +1.0pt 未満、かつ**希望ペア当事者の試合数超過が
  +0.5 未満**

`targetRatio` の既定値（UI 2段階）も同じ bench で決める。初期案は
**ひかえめ 0.35 / 積極的 0.6**。

---

## UI（予約ページ）

`src/pages/ReservationPage.tsx` に「ペア希望」セクションを追加する。予約リストと
**明確に別セクション**にする（消化されない・副作用が無い、という性質の違いが
一目で分かるように）。

```
試合予約                                    ← 既存ヘッダー
  [予約カード #1] [予約カード #2] …
  [ 予約追加 ]
  ▸ 消化済み (n)                            ← 既存

──────────────────────────────
ペア希望                       2組          ← 新規セクション
  ┌────────────────────────────┐
  │ たろう ＋ はなこ    積極的   3/6組  🗑 │
  └────────────────────────────┘
  [ ペア希望を追加 ]
```

- **カード**: 2人の名前（既存の性別カラー踏襲: M=blue / F=pink）、強度バッジ
  （ひかえめ / 積極的）、成立実績 `actual/opportunity`、削除ボタン
- **追加モーダル**: `PairPreferenceAddModal`（新規）。`ReservationAddModal` は
  流用しない — 選択上限が2人固定で、強度の選択が要り、予約側の
  カテゴリ推測（`inferDoublesCategory`）は不要なため。プレイヤー一覧の見た目・
  並び（待機中→休憩中）は `ReservationAddModal` に揃える
- **成立見込みの警告**: 追加モーダルに2段階で表示する（どちらもブロックはしない）。
  **ハード制約（`wideSpanThreshold`）を基準にすると実運用（最大25人）ではまず
  発火せず死にコードになる**ため、警告の主役は1グループ幅の方にする
  - 順位差 ≧ `ceil(人数 / 3)`（1グループ幅）→ 「実力帯が離れているため成立しにくい」
  - 順位差 ≧ `wideSpanThreshold` → 「実力差が大きく、成立しません」（22人なら
    1位×16位以降。ほぼ出ない想定だが、出たときに理由が分からないと困るので残す）
- **削除**: 予約と違い「消化済み」に落ちないので、削除だけが唯一の消し方
- **`BottomNav` のバッジ**: 予約件数のまま変更しない。ペア希望は「待っている件数」
  ではないので通知性を持たせない
- **権限**: 予約と同じく制限しない（`ReservationPage` に権限分岐は無い）
- **シングルスモード（`gameMode: 'singles'`）**: セクションごと非表示。ペアの概念が無い

---

## 変更ファイル一覧

### 新規
- `src/types/pairPreference.ts` — 型定義
- `src/stores/pairPreferenceStore.ts` — zustand（persist しない。`reservationStore` と同形）
- `src/components/PairPreferenceAddModal.tsx` — 追加モーダル
- `src/lib/pairPreference.ts` + `.test.ts` — `deficit` 算出の純粋関数。
  3b の試合数ガードもここに含める:
  `computeAffinityDeficits(preferences, players, pairCounts, medianGamesPlayed, blockThreshold)`

### 変更
| ファイル | 変更内容 |
|---|---|
| `src/services/sessionService.ts` | `GameState.pairPreferences?` 追加 |
| `src/services/sessionMutations.ts` | `computeAddPairPreference` / `computeRemovePairPreference` + `addPairPreference` / `removePairPreference`。`computeRemovePlayer` で該当希望を削除（予約と同じ整合処理）。`resetMatchState`（設定画面「試合をリセット」）では **`pairPreferences` を消さない**。履歴が消えて実績・機会が揃って 0 に戻るだけなので整合は保たれる |
| `src/hooks/useSessionWriter.ts` | 上記2つのラッパ追加 |
| `src/hooks/useFirebaseSync.ts` | `gameState.pairPreferences` → store へ反映（`jsonEqual` ガードは既存と同形） |
| `src/lib/pairing/objective.ts` | `ObjectiveWeights.affinity` / `computeAffinity` / `ObjectiveInput.affinityDeficitByPairKey` |
| `src/lib/pairing/assignRound.ts` | `AssignRoundParams.affinityDeficitByPairKey` を受けて `evaluate` と **`splitCost` の両方**へ渡す |
| `src/lib/algorithm.ts` | `AssignCourtsOptions.pairPreferences?` を受け、`buildHistoryCounts` の結果・`players`・**既存の中央値と `reservationBlockThreshold`**（予約保留判定と同じ値を使い回す）から `deficit` を算出して `assignRoundByObjective` へ渡す |
| `src/lib/gameOperations.ts` | `assignCourts` 呼び出しへ `pairPreferences` を渡す（`:291`） |
| `src/pages/MainPage.tsx` | 同上（`:728`） |
| `src/lib/nextMatchPrediction.ts` | 同上（`:111`）。**渡さないと配置予測が実配置とズレる** |
| `src/pages/ReservationPage.tsx` | ペア希望セクション |
| `scripts/bench-court-assignment.ts` | 希望ペア条件と成立率指標 |

**3つの `assignCourts` 呼び出し全てに渡すこと。** 特に `nextMatchPrediction.ts` を
忘れると、配置予測（`NextMatchPredictionBar` / 呼び出し通知 / 操作担当ガイド）が
実際の配置と違うメンバーを出す。

---

## 実装順序

1. 型・store・mutations・sync（データが往復するところまで）
2. UI（予約ページ + 追加モーダル）— この時点で登録・表示・削除ができる。
   アルゴリズムは未接続なので挙動は変わらない
3. `pairPreference.ts` の `deficit` 算出 + ユニットテスト
4. `objective.ts` の `computeAffinity` + ユニットテスト（重み 0 で既存挙動が
   1ビットも変わらないことを先に確認する）
5. `assignRound.ts` 接続（`evaluate` と `splitCost` の両方）
6. `algorithm.ts` / 3つの呼び出し側の配線
7. bench で `affinity` と `targetRatio` を決定 → `DEFAULT_WEIGHTS` へ反映

**4 と 5 の間で「`affinity: 0` なら既存の全テストが通る」ことを必ず確認する。**
既存の配置挙動への回帰が無いことの担保がここにしか無い。

## テスト

- `pairPreference.test.ts` — `deficit` 算出（機会0 / 目標到達 / 目標超過 / 片方未出場 /
  **試合数が中央値+2以上のメンバーを含むと `deficit` が 0 になる**（3b のガード））
- `objective.test.ts` — `computeAffinity`（味方 / 敵 / 別コート / 対象0件 / 片方ベンチ）
- `assignRound.test.ts` — 希望ペアが味方として配置される / ハード制約を破らない
  （順位差が大きい希望は成立しない・公平性の窓を飛び越えない）/ 目標到達後は
  他の目的が優先される / **相手が候補プールにいないラウンドでは挙動が変わらない**
  （3b の「中立」性質の回帰テスト）
- `sessionMutations.test.ts` — 追加・削除・`computeRemovePlayer` 連動・
  **追加しても `isResting` が変わらないこと**（予約との差分の回帰テスト）

## スコープ外

- 3人以上のグループ希望（`playerIds` は2人固定）
- 「この2人は組ませない」の逆希望（要求が出てから別 plan で）
- セッションを跨いだ希望の永続化（GAS / スプレッドシート側の話になる）
- 希望のために順位差・公平性のハード制約を緩めること
