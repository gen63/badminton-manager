# 終了操作の担当外（外部メンバー・管理者指定）

## 背景
試合の終了操作の担当は、配置予測の「ほぼ確定」メンバー `certainIds` がそのまま担当になっている。
初参加の外部メンバーに終了→配置→開始の一連を任せるのは難易度が高いので、担当から外したい。

## 方針
- **名前に「外部」を含む人は常に担当外**（`【外部】はなこ` 等も「含む」で判定）。
- **管理者が参加者ごとに担当外を設定できる**: `Player.excludeFromOperator?: boolean`。
  既存の `updatePlayer`（transaction）経由で保存。OFF は `false` を書く
  （`undefined` は `sanitize` で落ちて更新されないため）。
- 「担当」の意味で使う箇所だけ `operatorIds = filterOperatorIds(certainIds, players)` に切り替える。
  4:30 の呼び出し通知・管理者アナウンスは「試合に入る人」向けなので `certainIds` のまま。
- `canFinishGame` の「担当0人なら全員開放」は operatorIds 基準で効く。確定が外部のみでも誰も終われない事態にならない。

## 変更点
- `src/types/player.ts`: `excludeFromOperator?` 追加
- `src/lib/finishOperationGuide.ts`: `isOperatorExcluded` / `filterOperatorIds` 追加
- `src/pages/MainPage.tsx`: `operatorIds` を待機ガイド・`canFinishGame`・`buildFinishBlockedMessage` の名前・予測バーへ
- `src/pages/HistoryPage.tsx`: 「コートに戻す」権限も同じ operatorIds で判定
- `src/components/NextMatchPredictionBar.tsx`: `operatorIds` を追加。確定だが担当外は塗らず青枠のみ、凡例に「ほぼ確定（担当外）」
- `src/components/PlayerEditModal.tsx` / `src/pages/PlayerSelect.tsx`: 参加者編集モーダルに管理者だけの「終了操作の担当外」トグル（「外部」を含む名前は常に担当外の説明表示）
- テスト: 判定関数・フォールバック・ガイド除外・`computeUpdatePlayer`・予測バー表示
