# 待機ガイドを常時表示にし、待機場所を近接コートから決める

## 背景 / 課題

上部の待機ガイド（`FinishOperationGuide`）は 4:30（`MATCH_CALL_THRESHOLD_MS`）を
過ぎてからしか出していなかった。2026-08-18 の改訂でそうしたのは、4:30 未満のガイドが
「操作担当＋名前」しか言えず、配置予測バー（`NextMatchPredictionBar`）と顔ぶれが
丸かぶりだったため（`docs/plans/2026-08-18-finish-operation-guide.md`
「## 改訂: 4:30 以降のみに絞る」）。

しかし **待機場所は 4:30 を待たなくても分かる**。最も経過が長いプレイ中コートが
最も早く終わる見込みなので、あらかじめそのコート付近で待てることには実利がある。

一方で **3面同時開始のような場面では「①②③で待機」は場所を絞れておらず無意味**に
なる。逆に開始が1分以内に固まった2面なら「①②付近で待つ」は立ち位置を決められる
案内として成立する。

そこで、ガイドを常時表示に戻したうえで **待機場所を「近接コートの集合」から決め、
絞れないときは番号を落とす**。

## 決定事項

| 項目 | 決定 |
|---|---|
| 表示条件 | プレイ中コートがあり、担当（`certainIds` の未着席者）が1人以上いれば**常時** |
| 近接判定 | 経過最大コートとの差が **60秒以内**（`STANDBY_CLOSE_START_MS`、`<=`） |
| 近接1面 | `①付近待機` |
| 近接2面（隣接） | `①②付近待機`（既存語彙「付近待機」に揃える） |
| 近接2面（非隣接） | `コート付近待機`（番号なし。下記「## 改訂: 隣接2面に限る」） |
| 近接3面以上 / 1面運用 | `コート付近待機`（番号なし・常時表示のまま） |
| 見た目 | 4:30 未満は控えめ、4:30 以降はオレンジ＋一度だけ明滅 |
| 通知・読み上げ | **変更しない**（`buildNextMatchCallMessage` は `callBasisCourtId` のまま） |

近接上限は `STANDBY_MAX_COURTS = 2`。「①②の間」なら立ち位置を決められるが、
3面以上を並べても体育館の中央を指すのと変わらず場所の案内にならないため。

## 改訂: 隣接2面に限る

初版は開始が近い2面なら無条件に両方を並べていたが、`①③付近待機` のような**飛んだ
番号**は待つ場所を指していない。「その間」は間のコート（試合中）の上になってしまい、
実際には立てないため。

そこで2面を案内するのは **`id` が連番＝物理的に隣り合っているときだけ**にした。
隣接していなければ、どちらか一方を名指しして半分の確率で外すより、番号を落として
`コート付近待機` にする方が誠実（3面同時開始と同じ扱い）。

コート `id` は `computeResizeCourts`（`src/services/sessionMutations.ts`）が常に
1..N の連番へ振り直すため、`id` の差が 1 であることが「物理的に隣」と一致する。

## 設計

### 判定は純粋関数（`src/lib/finishOperationGuide.ts`）

- `standbyCourtIds(courts, now): number[]` を追加。経過が最大＝最も早く終わりそうな
  コートを起点に、そこから `STANDBY_CLOSE_START_MS` 以内で始まったプレイ中コートを
  `id` 昇順でまとめ、`STANDBY_MAX_COURTS` を超えたら空配列（＝場所を絞れない）。
  2面になる場合は `id` が連番のときだけ返し、飛んでいれば空配列。
  「経過最大のコート」は `nextMatchCall.ts` の `maxPlayingCourt` /
  `maxPlayingElapsedMs` をそのまま再利用する。
- `FinishOperationGuide` は `{ phase, courtIds, playerIds }`。
  `courtId: number | null` から `courtIds: number[]` へ変更し、空配列＝番号を出さない。
- `FinishGuidePhase = 'waiting' | 'imminent'` を復活（2026-08-18 で削除した型）。
  段階は `maxPlayingElapsedMs >= MATCH_CALL_THRESHOLD_MS` だけで決まる。
- 4:30 未満で `null` を返す早期リターンを削除。`null` を返すのは
  **プレイ中コートが無い / 担当が0人**のときだけ（据え置き）。
- `getNextFinishGuideDelay` は変更なし。待機場所は経過時間の**差**で決まり、差は
  時間が経っても変わらないので、再評価のきっかけは段階の切り替え（4:30）だけでよい。
  引き続き `CourtCardFrame` と同様に閾値までの `setTimeout` 1本で足りる。

### 表示（`src/components/FinishOperationGuide.tsx`）

2026-08-18 で一度撤去した2段階の見た目を戻す。ただし文言は待機場所だけを言う
現行の方針（アイコンは `MapPin`、「操作担当」は配置予測バーの担当）を維持する。

| | `waiting`（4:30 未満） | `imminent`（4:30 以降） |
|---|---|---|
| 枠・地色 | `bg-muted/40 border-border text-muted-foreground` | `bg-orange-50 border-orange-300 text-orange-800` |
| 見出し | `font-medium` | `font-bold`＋アイコン `text-orange-600` |
| 自分が担当のリング | `ring-indigo-300` | `ring-orange-400` |
| 自分の名前チップ | `bg-indigo-600` | `bg-orange-600` |

待機段階のリング／チップを配置予測バーと同じ indigo にするのは、ここでオレンジに
すると「もう終わりそう」に見えてしまうため。

明滅（`finish-guide-flash`）の起点は「非表示 → 表示」から **`waiting` → `imminent`**
へ戻す。ref を `FinishGuidePhase | null | undefined` にし、`undefined`＝初回
（開き直しで最初から `imminent` なら光らせない）、`null`＝非表示（そこからの復帰は
変化なので光らせる）で区別する。

## トレードオフ

3面近接・1面運用では番号が出ないため、2026-08-18 に取り除いた「配置予測バーと顔ぶれが
重複する」状態がその場面に限り戻る。4:30 未満を控えめな地色にすることで上部の圧を
抑え、常時表示の利（早めに待機場所へ移動できる）を優先する判断とした。

## 表示領域の扱い

常時 44px を使う（従来は 4:30 以降のみ）。出す必要が無いとき（プレイ中コート無し・
担当0人）に空の余白行が残らないよう、`px-4 pt-2` をコンポーネント側に持たせる点は
据え置き。

## スコープ外

- 4:30 の OS 通知・チャイム・読み上げの文言（`buildNextMatchCallMessage` /
  `buildAdminMatchCallMessage` と `callBasisCourtId`）は現状維持。近接2面でも
  読み上げは従来どおり1コートだけを言う。まず画面で運用感を確かめてから判断する。
- `NextMatchPredictionBar` の見出し・凡例は変更しない。
