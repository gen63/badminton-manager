# オートセッション作成で外部メンバーに到着調整「遅刻救済 0」を付ける

## 目的

名前に「外部」を含む人（外部参加者）は、どんなに早く着いても名簿・支払いが遅れがち
（試合の合間に PayPay 送金のやり方を教える、なども普通に起きる）。滞在時間モードの起点は
受付完了（会費・名簿の両方完了）なので、本人の責任ではない分まで滞在が短くなってしまう。

オートセッション作成（`scripts/auto-create-session.ts`、GitHub Actions `auto-session.yml`）で
外部の人を作るときに、既存の到着調整「遅刻救済 0」を初期値として付けて、これを防ぐ。

## 経緯（仕様の簡略化）

当初案は「起点を、そのセッションで一番早く受付完了した人に合わせる」新しい kind（`earliest`）と、
オートセッション作成の ON/OFF オプションだった。ユーザー指示で次のとおり簡略化した:

- 新しい kind は作らず、既存の `arrivalAdjustment: { kind: 'ratio', ratio: 0 }`（遅刻救済「0」）を使う。
  意味は「受付完了がいつでも、練習開始から居たとみなす」。最早到着者に合わせるより少しだけ有利
  （最早の人も練習開始より後なら、その差の分）になるが、`resolveStayStart` と呼び出し側
  （algorithm・playerStats・reservationGate・モーダル）を一切変えずに済む。
- オプション（設定項目・環境変数・workflow inputs）は追加せず、常に付ける。

## 仕様

- `src/lib/operatorExclusion.ts` に `defaultArrivalAdjustment(name)` を追加。
  名前に「外部」を含めば `{ kind: 'ratio', ratio: 0 }`、それ以外は undefined。
  判定は既存の `defaultExcludeFromOperator`（終了操作の担当外の初期値）と同じ目印（`includes('外部')`）。
- `scripts/auto-create-session.ts` の、プレイヤーを作る2か所で付ける:
  - `buildSessionData`（新規セッション作成。E-ToMo の参加者から作成）
  - `computeRosterSync`（既存セッションへの出欠同期で追加される人）。既存の人には付けない（上書きしない）。
- 会費・名簿が未完了の間は、従来どおり滞在 0（`resolveStayStart` のルールそのまま）。
- 作成時の初期値にすぎず、管理者は参加者編集の「到着調整」で解除・変更できる。
  受付前は一覧に「遅刻連絡」バッジ、受付完了後に効いていれば「到着調整」バッジが出る（既存の挙動）。

## 調査メモ

- auto-create-session.ts: 毎日 06:00 JST（翌日分）と 17:30 JST（当日分、`TARGET_DATE=nearest`）に Actions から実行。
  E-ToMo のイベント一覧・詳細から参加者（出席予定メンバー＋「外部」「参加」を含むコメント）を取得し、
  GAS の tmp シートでレーティングを補完して、Firestore にセッションを作成（既存なら出欠同期）。
  設定は環境変数（`ETOMO_URL` / `GAS_WEB_APP_URL` / `DISCORD_WEBHOOK_URL` / `TARGET_DATE` / `VITE_FIREBASE_*`）と
  workflow_dispatch の `target_date` のみ。
- 「外部」の名前の実例: `外部はなこ`、`【外部】はなこ`、`太郎（外部）`、`外部まや`、E-ToMo コメント由来の `外部ゲスト1名参加`。
  既存の外部向け扱い: `excludeFromOperator`（終了操作の担当外の初期値。auto-create と `computeAddPlayers` の両方）、
  読み上げで「外部」接頭辞を読まない（`nextMatchCall.ts`）。

## 非対象・提案

- アプリ上で手動追加した人（`computeAddPlayers`）には付けない。`computeAddPlayers` は既に
  `defaultExcludeFromOperator` を使っているので、同じ1行で `defaultArrivalAdjustment` も付けられる（提案のみ）。

## 変更ファイル

- `src/lib/operatorExclusion.ts` — `defaultArrivalAdjustment`
- `scripts/auto-create-session.ts` — `buildSessionData` / `computeRosterSync` で付与
- `scripts/auto-create-session.test.ts` — 付与のテスト

## テスト

- `buildSessionData`: `外部はなこ` / `【外部】たろう` / `太郎（外部）` / `外部ゲスト1名参加` に付き、外部以外には付かない（フィールド自体なし）。
- `computeRosterSync`: 追加される外部の人に付き、追加される外部以外・既存の人には付かない。
