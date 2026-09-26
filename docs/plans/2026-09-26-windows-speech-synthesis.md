# Windows（Edge / Chrome）で呼び出しの読み上げが鳴らない問題の対策

## 背景
日本語版 Windows の Edge で、呼び出しのチャイム後の読み上げ（`speechSynthesis`）が鳴らない。
iOS / Android では鳴っている。対象は `src/lib/matchCallAlert.ts` の `speakMatchCall` だけ。

## 推定原因（Chromium 系の既知の挙動）
1. `utterance.lang = 'ja-JP'` だけで `voice` を指定していないため、既定音声（英語や
   「Online (Natural)」系のネットワーク音声）に回されて無音になることがある。
   音声一覧も非同期ロードで、初回の `getVoices()` は空。
2. `speak()` の直前に毎回 `cancel()` していた。Chromium は `cancel()` 直後の `speak()` を
   捨てることがある。最初のタップ（`primeSpeechSynthesis` の無音発話）の直後にベルの
   テスト再生が続くケースでは、ちょうどこの問題を踏む。
3. `speechSynthesis` が内部的に paused のまま固まり、発話がキューに溜まるだけになる。
4. 参照の切れた utterance が GC で回収され、途中で止まる / `onend` が来ない。

## 対策
- `pickJapaneseVoice()`: 日本語音声のうち端末内蔵（`localService`）を優先して選び、
  無ければネットワーク音声を含む日本語音声を使う。無ければ従来どおり lang のみ。
- `installMatchCallAudioUnlock()` で `getVoices()` を一度呼び、音声一覧のロードを早めに始めさせる。
- `cancel()` は `speaking || pending` のときだけにし、その場合は `CANCEL_SETTLE_MS`（100ms）
  待ってから話す。待ちのタイマーは既存の `pendingSpeechTimeoutId` を使うため、
  タップキャンセルと hidden ガードでそのまま捨てられる。
- `speak()` の直前に `resume()` を呼ぶ。
- 発話中の utterance をモジュール変数で保持し、GC されないようにする。
- `onerror` の `event.error`（interrupted / canceled 以外）を `console.warn` に出し、
  現地で原因を切り分けられるようにする。

## 見送り
- `primeSpeechSynthesis` の空文字発話の変更: iOS で機能しているため触らない。
- 設定画面での音声診断表示・クラウド TTS: 今回の修正で直らなければ別途検討する。
