# バックグラウンド復帰時に「とっくに始まった試合」の呼び出しが鳴る問題

## 症状

アプリをバックグラウンドに置いてから戻すと、**すでに始まっている（もしくは終わって
いる）試合についての呼び出し読み上げ**が鳴り出すことがある。
「◯◯さん、3コート付近で試合終了をお待ちください」と言われた時点で、当人はもう
コートに立っている、というような状態。

## 原因

呼び出し（`MainPage` の 10 秒ごとの `evaluate`）は次の 2 経路で「過去の状態」を
持ち出してしまう。

### 1. 復帰直後の評価が古い `courts` を見ている

`useFirebaseSync` はタブが 60 秒以上 hidden だった場合、visible 復帰で
`requestReconnect()` → 再購読を行う。**再購読の初回スナップショットが届くまで**、
zustand の `courts` はバックグラウンドに入る前の内容のまま残る。

一方 `evaluate` は `Date.now()` を都度取り直すため、

- `maxPlayingElapsedMs` = 「とっくに終わった試合の `startedAt`」からの経過 →
  当然しきい値 4:30 を超える
- 自分はコートに乗っていない（古いスナップショットでは乗っていない）
- 「ほぼ確定」メンバーにも古い予測で含まれている

が揃い、実際にはもう始まっている試合について呼び出しが発火する。
Chrome はバックグラウンドタブのタイマーを 1 分に 1 回程度へ絞るだけで止めはしない
ため、復帰直後にたまった tick が走るのも同じ結果になる。

### 2. hidden 中に積んだ読み上げが復帰時に再生される

`speechSynthesis.speak()` は hidden 中でも呼べてしまうが、iOS 等は読み上げを
**キューに積んだまま保留し、visible 復帰時にまとめて再生する**。
そのため「バックグラウンド中に鳴った（はずの）呼び出し」が、数分後の復帰時に
そのまま読み上げられる。WebAudio のチャイムも AudioContext が suspend されると
同様に復帰時へずれ込む。

## 対処

### A. 復帰直後は評価しない（`canEvaluateMatchCall`）

`src/lib/nextMatchCall.ts` に純粋関数 `canEvaluateMatchCall()` を追加し、
`evaluate` の先頭でガードする。次のどちらかなら評価そのものを行わない
（＝OS 通知も音も出さない。古い状態に基づく通知は出さないほうがよい）。

1. `isGameStateLoaded === false` — 再購読中／初回スナップショット未受信。
   `useFirebaseSync` は再購読のたびに false → 初回受信で true に戻すので、
   「Firestore の最新が手元にあるか」の判定にそのまま使える。
   同期エラー中も false のままなので、切断中の古い状態では鳴らない。
2. visible 復帰から `MATCH_CALL_RESUME_GUARD_MS`（5 秒）以内。
   `visibilitychange` → `requestReconnect()` → React の再レンダリングで
   `isGameStateLoaded=false` になるまでには数ミリ秒のすき間があり、そこへ
   復帰直後の tick が刺さり得るため、時間でも塞ぐ。

評価を飛ばしても 10 秒ごとの tick で次の評価が来るので、正当な呼び出しは
最大 10 数秒遅れるだけ。4:30 のしきい値・5〜9 分の試合長に対して許容範囲とする。

### B. hidden 中は音・振動・読み上げを出さない

- `fireMatchCallAlert()` は `document.visibilityState === 'hidden'` なら何もしない。
- `speakMatchCall()` 自体も hidden なら `speak()` を呼ばない
  （チャイム後 200ms 遅れて読み上げる間にバックグラウンドへ回った場合の保険）。
- `installMatchCallSpeechHideGuard()` を追加し、hidden へ移った瞬間に
  `cancelMatchCallSpeech()` する（発話中／`setTimeout` 待ちのものを捨てる）。
  `cancelMatchCallSpeech()` は保留中の読み上げ `setTimeout` もクリアするようにした。

バックグラウンドの人に気づかせる役割は **OS 通知**（`notifyNextMatchSoon`）が
引き続き担う。hidden 中は `navigator.vibrate` が仕様上無視され、WebAudio も
suspend されうるので、実質「復帰時にずれて鳴る」以外の効果はほとんど無い。
確実に今の状態を読み上げるほうを優先する。

## 変更ファイル

- `src/lib/gameOperations.ts` — `MATCH_CALL_RESUME_GUARD_MS` を追加
- `src/lib/nextMatchCall.ts` — `canEvaluateMatchCall()` を追加
- `src/lib/matchCallAlert.ts` — hidden ガード / 保留 `setTimeout` の管理 /
  `installMatchCallSpeechHideGuard()`
- `src/pages/MainPage.tsx` — 復帰時刻の記録と `evaluate` 先頭のガード、
  hide ガードの登録
