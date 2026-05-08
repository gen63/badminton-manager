# 連続モードトグルの「OFF操作も不能」問題を修正

## 背景

20人 × 3コート（作成者が操作）で、連続モード (`continuousMatchMode`) のオン/オフ
トグルが意図しないタイミングで操作不能になる事象が報告された。

調査の結果、`src/pages/MainPage.tsx:549` の `disabled` 条件が **ON操作と
OFF操作で同じガード** を共有しているのが原因と判明:

```tsx
disabled={shouldBlockContinuous || continuousModeToggle.isPending}
```

- `shouldBlockContinuous` は `MainPage.tsx:377-385` → `lib/utils.ts:155-181`
  (`shouldBlockForDiversity`) で算出。
  `prioritizeDiversity=true` かつ
  `waitingCount - max(emptyCourts,1) * 4 ≤ getMinWaitingCount(gameMode)`
  (=7 ダブルス) のとき true。
- 20人 × 3コート × `練習種別=楽`（`prioritizeDiversity=true` 強制 /
  `settingsStore.ts:40`）の場合、
  3コート稼働中＝12プレイ中・8待機 → `8 − 4 = 4 ≤ 7` → ブロック発動。
- このガードは本来「ONしても直後の `computeFinishAndContinue` で
  `diversity_block` 判定 → 自動 OFF (`gameOperations.ts:210-213`)
  されてしまう状態」を抑止する意図。
- しかし OFF 操作は常に安全（次の試合終了時の自動配置が止まるだけ）にも関わらず、
  同じ disabled が適用されるためユーザーが連続モードを **OFFにすることもできない**。
- さらに `gameOperations.ts:210-213` の自動 OFF と組み合わさり、「勝手に OFF
  にされる → 再 ON しようとしても押せない」という分かりにくい挙動が発生する。

意図する挙動: **OFF 操作は常に許可、ON 操作のみ多様性ブロックでガード**。

## 変更内容

### `src/pages/MainPage.tsx`

連続モードトグルの disabled 式を、現在 OFF のときだけ多様性ブロックを適用する
形に変更（line 549）:

```diff
- disabled={shouldBlockContinuous || continuousModeToggle.isPending}
+ disabled={(!continuousMatchMode && shouldBlockContinuous) || continuousModeToggle.isPending}
```

意味:
- 現在 OFF（`!continuousMatchMode`）かつブロック条件成立のときのみ disabled
  → ON 方向のガードは不変。
- 現在 ON のときはブロック条件に関わらず常にクリック可能（OFF にできる）。
- `continuousModeToggle.isPending` は `useGuardedAction` の二重実行防止として
  そのまま維持。

### 変更しない箇所（確認のみ）

- `src/lib/gameOperations.ts:210-213` — 試合終了時の自動 OFF はそのまま維持。
  本修正後はユーザーが手動で先回り OFF できるようになる。
- `src/pages/MainPage.tsx:247-254`, `438-441` — コート追加時 / 休憩切替時の
  プログラマティック自動 OFF。ユーザートグルではないので変更不要。
- `src/services/sessionMutations.ts:726-728` — `setContinuousMatchMode` mutation。
  値の検証なし。OFF への遷移は元から無条件で成功するので追加ガード不要。
- `src/hooks/useGuardedAction.ts` — `finally` で `isPending` を必ず解放。
  スタック懸念なし。
- 「一括」自動配置ボタン (`MainPage.tsx:565-572`) は `disabled={!canAutoAssign}`
  でワンショット動作のため ON/OFF 非対称性なし。変更不要。

## ユニットテスト追加について

**追加しない方針**。disabled 式は 3 項のブール式で、構成要素 `shouldBlockForDiversity`
は `src/lib/utils.test.ts:101-187`（threshold=7 ケース含む 176-186 行）で既にカバー
済。1 行のロジック整合のためにテスト用ヘルパー関数を切り出すと過剰抽象化になる。

## 検証

CLAUDE.md のコミット前チェックを順守:

```bash
npm run build      # 型チェック + ビルド
npm run lint       # コードスタイル
npm run test:run   # ユニットテスト
```

### 手動シナリオ（20人 × 3コート、`練習種別=楽`）

1. 3 コート全稼働状態（12 プレイ中・8 待機）で「連続 ON」表示の状態。
2. 連続ボタンをクリック → **OFF にできる**ことを確認（修正前は disabled）。
3. OFF のまま試合終了 → 自動配置が走らないことを確認、待機が増える。
4. 待機が threshold (8 人) を超えた瞬間に連続ボタンが再度クリック可能になり、
   ON に戻せる。
5. 自動 OFF パス（連続 ON のまま試合終了 → `diversity_block`）でも、
   その後ユーザーが「再 ON」したくなったら待機回復まで disabled、回復後は ON 可能。

## 影響範囲・リスク

- 機能変更: 連続モードトグルが OFF 方向に常に押下可能になる（管理者のみ表示）。
- 既存挙動への破壊なし（`shouldBlockContinuous=false` のケースは挙動不変、
  ON への遷移時のガードも不変）。
- データ層・トランザクション層の変更なし。
- リスク評価: 最小。
