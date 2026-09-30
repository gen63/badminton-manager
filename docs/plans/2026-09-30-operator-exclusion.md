# 終了操作の担当外（管理者指定・外部は作成時の初期値）

## 背景
試合の終了操作の担当は、配置予測の「ほぼ確定」メンバー `certainIds` がそのまま担当になっている。
初参加の外部メンバーに終了→配置→開始の一連を任せるのは難易度が高いので、担当から外したい。

## 方針
- **担当外かどうかは `excludeFromOperator === true` だけで判定**（名前では判定しない）。
- **名前に「外部」を含む人は、作成時の初期値だけ `excludeFromOperator: true`**
  （`defaultExcludeFromOperator(name)`、`src/lib/operatorExclusion.ts`）。効く経路: オートセッション作成
  （`scripts/auto-create-session.ts` の新規作成・出席者同期の追加）、手動セッション作成
  （`SessionCreate.tsx`）、参加者の追加（`computeAddPlayers`）。既存プレイヤーの値は変えない。
  名前で常時除外にしなかった理由: 意欲ある外部の方を管理者が担当に任命したい／端末不調の既存メンバーも外したい、を両立するため。
- **管理者が参加者ごとに担当／担当外を切り替えられる**（モーダルは肯定形「終了操作担当」ON＝担当、OFF＝担当外）: `Player.excludeFromOperator?: boolean`。
  既存の `updatePlayer`（transaction）経由で保存。OFF は `false` を書く
  （`undefined` は `sanitize` で落ちて更新されないため）。
- 「担当」の意味で使う箇所だけ `operatorIds = filterOperatorIds(certainIds, players)` に切り替える。
  4:30 の呼び出し通知・管理者アナウンスは「試合に入る人」向けなので `certainIds` のまま。
- `canFinishGame` の「担当0人なら全員開放」は operatorIds 基準で効く。確定が外部のみでも誰も終われない事態にならない。

## 変更点
- `src/types/player.ts`: `excludeFromOperator?` 追加
- `src/lib/finishOperationGuide.ts`: `isOperatorExcluded`（フラグのみ判定）/ `filterOperatorIds` 追加
- `src/pages/MainPage.tsx`: `operatorIds` を待機ガイド・`canFinishGame`・`buildFinishBlockedMessage` の名前・予測バーへ
- `src/pages/HistoryPage.tsx`: 「コートに戻す」権限も同じ operatorIds で判定
- `src/components/NextMatchPredictionBar.tsx`: `operatorIds` を追加。確定だが担当外は塗らず青枠のみ、凡例に「ほぼ確定（担当外）」
- `src/components/PlayerEditModal.tsx` / `src/pages/PlayerSelect.tsx`: 参加者編集モーダルに管理者だけの「終了操作の担当外」トグル（肯定形、全員に同じトグル）
- テスト: 判定関数・初期値関数・フォールバック・ガイド除外・`computeUpdatePlayer`・予測バー表示
