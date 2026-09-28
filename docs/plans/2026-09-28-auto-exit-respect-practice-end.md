# 自動退出が練習終了予定時刻を無視する不具合の修正

## Context / 根本原因

`useSessionAutoExit`（60秒 tick）は `shouldAutoExitSession`（実体は
`isSessionVisible`）を使い、「試合開始済み」かつ「コート進行中でない」かつ
「最後の試合が終わってから30分経過」で `leaveSession` を呼んで participants
から自分を消す。

休憩・基礎打ち・長めの話し合いなどでコートに試合が一つも乗らない時間が30分を
超えると、この条件が成立してしまい、**その瞬間アプリを開いている端末だけ**が
自分から退出してしまう。アプリを閉じている（画面が閉じている・スリープ中の）
端末は tick 自体が走らないため退出しない。結果として「一部のメンバーだけ
participants から消える」ような、一見ランダムに見える現象になっていた。
同じ条件は一覧の非表示判定（`isSessionVisible`）にも使われているため、
練習中のセッションが一覧からも一時的に消える副作用も同時に起きていた。

## 判定の変更

`isSessionVisible` の `firstMatchStartedAt` 分岐に、12h 絶対上限チェックの
**直後・hasActiveCourt チェックより前**に新しいガードを追加した。

- `resolvePracticeEndTime(session.config)`（`src/lib/practiceEndPhase.ts` の
  既存関数。`practiceEndTime` > 0 があればそれ、無ければ
  `practiceStartTime + 3時間`、開始時刻も無ければ `undefined`）を計算する。
- 結果が `undefined` でなく、かつ `now < practiceEndTime` なら**無条件で
  表示（＝自動退出しない）**。休憩中でコートが空でも、最後の試合から
  30分を超えていても、練習が終わる予定時刻を迎えるまでは追い出さない。
- 12h の絶対上限（試合開始から12時間）は**このガードより先に評価**するため、
  `practiceEndTime` がどれだけ未来でも 12h 上限は必ず勝つ（解散し忘れて
  コートが進行中のまま残ったセッションが永久に居座らないようにするための
  安全弁を壊さない）。
- `practiceEndTime` が無い・過ぎている場合は、従来どおり
  `hasActiveCourt` → `lastMatchFinishedAt` から30分、の判定にフォールバックする。

`shouldAutoExitSession` は `isSessionVisible` に委譲しているだけなので、
自動退出・一覧非表示の両方に自動でガードがかかる。型のうえでも
`config` に `practiceEndTime?: number` を受け付けるようにした。

`practiceEndPhase.ts` は型のみを import しており `sessionArchive.ts` を
参照していないため、`resolvePracticeEndTime` を import しても循環参照は
発生しない。

呼び出し元（`sessionService.ts` の `docToSession` / `subscribeToRecentActiveSessions`、
`SessionSelectPage.tsx`）はもともと `config` をそのまま `Session['config']`
として渡しており、`Session['config']` 型に `practiceEndTime?: number` が
既に存在するため、マッピング側の変更は不要だった（確認のみ）。

## テスト

`src/lib/sessionArchive.test.ts`:
- `practiceEndTime` 未経過なら、コートが空・最終試合から30分超でも表示
- `practiceEndTime` 未設定でも `practiceStartTime + 3h` 未経過なら表示（既定終了時刻）
- `practiceEndTime` 経過後は従来どおり30分ルールで非表示
- `practiceEndTime` が遠い未来でも12h絶対上限が勝つ
- どちらも無ければ従来どおり30分ルールのみで判定（後方互換）
- `shouldAutoExitSession` にも同様のガードあり/なしのケースを追加

`src/hooks/useSessionAutoExit.test.ts`:
- 休憩などで最後の試合から31分経っても、練習終了予定時刻前なら
  `leaveSession` が呼ばれない・セッションに留まることを確認するケースを追加

既存の `useSessionAutoExit.test.ts` の `setupSession` は
`practiceStartTime: NOW - 4時間` を使っており、既定終了時刻
（開始+3h = NOW-1h）は既に過ぎているため、既存アサーションは変更不要だった。
