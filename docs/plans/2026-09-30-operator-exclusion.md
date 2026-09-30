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

## 担当の繰り上げ（2026-09-30 追記）
3コート稼働などでは全シナリオ共通（出現率100%）の確定者が出ない、または確定者が全員担当外になり、
operatorIds が空 → `canFinishGame` の全員開放で「気づいた人が押す」運用に戻っていた。なるべく誰かを担当にしたい。

- `selectOperatorIds(prediction, players)`（`finishOperationGuide.ts`）を追加。`filterOperatorIds(certainIds)` が
  非空なら従来どおり。空のときだけ **繰り上げ**: 予測バーに出る人（`certainIds` + `likelyIds`）のうち、
  担当外を除いて出現率が 0 より大きい人の **最高出現率の人（同率は全員）** を担当にする。
  候補も居なければ空集合で、`canFinishGame` の全員開放は最後の保険として残る。
- 繰り上げ対象を予測バー表示者に限る理由: `likelyIds` は「閾値 0.5 以上 or 定員補充」の先頭からの連続範囲なので、
  担当外の人が上位を占めると、担当外を除いた最高出現率の人が表示されない場合があるため。
  担当なのに画面に出ない人を作らない。
- MainPage の `operatorIds`（終了権限・案内名・待機ガイド・予測バー）と HistoryPage の「コートに戻す」権限は同じ集合。
- 予測バー: `certainIds` に居ないが operatorIds にいる人も濃い青。凡例「ほぼ確定＝操作担当」→「操作担当」
  （見出し「配置予測（操作担当）」と整合）。担当外の太枠は「certainIds 内 & 担当外」のまま。
- 4:30 呼び出し通知・管理者アナウンスは従来どおり `certainIds`。

## 担当外でも確定なら終了ボタンは押せる

「担当」の意味を「名指しで一連（終了→配置→開始）を任せる」だけに限定した。担当外の人でも
「ほぼ確定」なら、その人は次の試合に必ず入る本人なので、終了ボタンだけは押してよい（特定の人に
押させる必要がない）。

- `finishAllowedIds(operatorIds, certainIds)` を追加: 操作担当 + ほぼ確定の和集合。
- MainPage / HistoryPage の `canFinishGame` の `certainIds` に `finishAllowedIds(...)` を渡す。
- 待機ガイド（`buildFinishOperationGuide`）・名指し（`buildFinishBlockedMessage`）・予測バー表示は
  引き続き `operatorIds` （操作担当の提示）を使用（担当外は「任せない」だけ）。
