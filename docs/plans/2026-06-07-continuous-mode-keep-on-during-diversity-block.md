# 連続モードを diversity_block で自動 OFF にしない

## 背景・問題提起

`練習種別 = 楽`（`prioritizeDiversity=true` 強制）では、待機人数が
`getMinWaitingCount(gameMode)`（ダブルス=7人、シングルス=3人）以下になると
連続モードの ON トグルが押せなくなる仕様だった
（`docs/plans/2026-05-08-continuous-toggle-off-always-allowed.md` で OFF 方向は
解放済みだが、ON 方向のガード `shouldBlockContinuous` は維持されていた）。

運用してみたところ「連続モードを ON にしたい場面で押せない」ことが多く、
利便性を損なっていた。ON 方向のガードを単純に外すと、今度は
`computeFinishAndContinue` が試合終了直後に `diversity_block` を検知して
`continuousMatchMode` を自動 OFF にする仕様（`gameOperations.ts` の
旧 `newSettings` 上書き）と衝突し、「ON にしても直後に OFF に戻される」と
いう分かりにくい挙動が再発する。

## 結論：自動 OFF 仕様を廃止する

ON ボタンの事前ガード（`shouldBlockContinuous`）と、試合終了時の自動 OFF
（`continuousError === 'diversity_block'` → `continuousMatchMode: false`）は
表裏一体で、後者を残す限り前者を外せない。

これら2つの仕様のうち、**自動 OFF のほうを廃止する**。理由:

- 多様性保護の本体は `checkContinuousBlock`（`diversity_block` 判定）が担って
  おり、これは「待機人数が足りない回の自動配置を1回スキップする」だけで
  十分に機能する。連続モード自体を OFF にする必要はない。
- 自動 OFF を残すと、待機人数の増減のたびに連続モードが勝手に ON/OFF を
  繰り返し、ユーザーが「設定したのに維持されない」体験になる。
- 自動 OFF を廃止すれば、ON 方向の事前ガードも存在意義を失うため、
  合わせて撤去できる → 管理者はいつでも連続モードを ON/OFF できるようになる。

## 変更内容

### `src/lib/gameOperations.ts`

`computeFinishAndContinue` から `diversity_block` 時に
`settings.continuousMatchMode` を `false` に上書きする処理を削除。
`newState.settings` は元の `state.settings` をそのまま保持する
（多様性チェック自体・その回の自動配置スキップは変更なし）。

### `src/pages/MainPage.tsx`

- 連続モードトグルの `disabled` から `shouldBlockContinuous` 判定を削除
  （`continuousModeToggle.isPending` のみでガード）。
- 不要になった `shouldBlockContinuous` 変数を削除
  （`shouldBlockAssignment` 用の `shouldBlockForDiversity` 呼び出しは維持）。
- `diversity_block` 時のトーストメッセージを「連続モードを停止しました」から
  「この試合の自動配置を見送りました」に変更（モード自体は維持されるため）。

### `src/lib/gameOperations.test.ts`

「diversity block 発動時は settings.continuousMatchMode を OFF にする」テストを
「diversity block 発動時も OFF にしない（その回の自動配置のみ見送る）」に更新。

## 変更しない箇所（確認のみ）

- `checkContinuousBlock` / `diversity_block` 判定そのもの: 多様性保護の中核
  ロジックなので維持。
- `MainPage.tsx` の `handleAddCourt`（コート追加時）・`toggleRest`（休憩切替時）
  のプログラマティック自動 OFF: 診断対象が異なる別の安全装置であり、
  ユーザートグルのガードとは独立しているため変更不要
  （`docs/plans/2026-05-08-...md` でも変更対象外と確認済み）。
- `shouldBlockForDiversity` / `shouldBlockAssignment`（一括配置ボタンの
  ガード）: 別機能のため変更なし。

## 検証

```bash
npm run build && npm run lint && npm run test:run
```

すべて green（test:run は既存 386 件 + 更新 1 件）。

### 期待される手動シナリオ（`練習種別=楽`）

1. 待機人数が少ない状態でも連続トグルが常にクリック可能。
2. ON にした直後に試合が終了し `diversity_block` が発動しても、
   その回の自動配置だけスキップされ、連続モードは ON のまま維持される
   （トースト「待機人数が少ないため、この試合の自動配置を見送りました」）。
3. 待機人数が回復すれば、ON のまま自動配置が再開する
   （ユーザーが再度 ON にし直す手間が無い）。

## 影響範囲・リスク

- 機能変更: 連続モードトグルが常時 ON/OFF 可能になる（管理者のみ表示）。
  `diversity_block` で連続モードが勝手に OFF にならなくなる。
- 多様性保護自体（低多様性ペアの自動配置スキップ）は変更なし。
- データ層・トランザクション層の構造変更なし（`settings` 上書きを削除するのみ）。
- リスク評価: 小。既存テストで広くカバーされており、green を確認済み。
