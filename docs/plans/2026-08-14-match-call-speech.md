# 呼び出し通知の音声読み上げ

## 背景

`2026-08-14-match-call-vibration-sound.md` で呼び出し通知にビープ音と振動を足した。
ビープは「何か起きた」ことしか伝えられないので、端末を見ないままでも内容が分かる
よう Web Speech API（`speechSynthesis`）で読み上げる。

読み上げる内容は**トーストと同じ**（「3コート付近で試合終了をお待ちください」＋対象者名）。

## 技術的な前提

- `speechSynthesis` は iOS Safari / Android Chrome とも対応。日本語音声は
  iOS が Kyoko、Android が Google 音声合成として標準搭載。追加ライブラリ・
  音声ファイルは不要。
- **初回はユーザー操作起点で `speak()` を呼ぶ必要がある**（特に iOS）。既存の
  `installMatchCallAudioUnlock()` が最初の `pointerdown` / `keydown` を捕まえて
  いるので、そこに TTS のプライミングを相乗りさせる。
- iOS の消音スイッチは既存方針どおり尊重する（回避しない）。

## 名前の読みについて

`Player` には `name: string` しかなく、よみがなフィールドは無い。ただし本アプリの
登録名は**カタカナ・ひらがなのニックネームが中心**なので、そのまま読ませて実用に
なるという判断。よみがなフィールドの追加はしない。

ただし登録名には記号が混じることがある（`ゆうき★` 等）。記号は TTS が変な読み方を
するため**読み上げ前に除去**する。

### `sanitizeNameForSpeech(name: string): string`

- **残す**: ひらがな・カタカナ・漢字・英数字・長音符（`ー`）・`々`
- **除去**: それ以外（記号・絵文字・空白）
- 除去後に空文字になった名前は読み上げ対象から外す（`（）` だけ読まれるのを防ぐ）
- 表示（body / toast）には一切影響させない。**読み上げ専用の加工**とする。

## 設計

### 1. 読み上げ文の組み立て（`src/lib/nextMatchCall.ts`）

`buildNextMatchCallMessage` の戻り値に `speech` を追加し、`{ body, toast, speech }`
にする。文言の組み立てを1箇所に集約する既存方針を維持する。

`speech` はトーストと同内容だが、**「名前 → 用件」の順**にし、TTS が読みやすい
区切りにする:

- 名前あり: `太郎さん、花子さん。3コート付近で試合終了をお待ちください`
  - body / toast は「見出し → 名前」だが、speech だけ順序を反転する
  - 括弧は使わない（TTS が不自然に読む/長く止まるため）
  - 名前の区切りは `・` ではなく `、`
- 名前なし（sanitize で全滅した場合を含む）: 見出しのみ

**名前を先頭に置く理由（カクテルパーティ効果）**: 体育館の喧騒下では音声通知の
頭が聞き取れなかったり、用件部分を聞き流されたりしやすい。自分の名前は雑音下でも
無意識に注意を引く（カクテルパーティ効果）ため、名前を最初に発話することで
「自分宛の呼び出しだ」と早い段階で気づいてもらえる。

**自分の名前を先頭に寄せる理由**: `buildNextMatchCallMessage` は第3引数
`selfName?: string` を受け取る。対象者が複数いる場合、聞いている本人にとって
重要なのは自分の名前であり、他人の名前が先に読まれると聞き逃す可能性が残る。
そのため `selfName` を渡すと、sanitize 後の名前リストの中からそれを探し出し
（比較は `sanitizeNameForSpeech` 適用後の文字列同士で行う）、他の名前の相対順序を
保ったまま先頭へ移動する。`selfName` を渡さない場合や、渡しても一致する名前が
無い場合は、名前の並び順は変えない。

### 2. 読み上げの実行（`src/lib/matchCallAlert.ts`）

- `speakMatchCall(text: string): void` — `SpeechSynthesisUtterance` に
  `lang = 'ja-JP'` を設定して `speak()`。未対応環境・失敗時は黙って何もしない。
  発話前に `speechSynthesis.cancel()` して読み上げの積み残しを消す。
- `primeSpeechSynthesis(): void` — 空に近い発話を一度流して iOS の
  ユーザー操作要件を満たす。`installMatchCallAudioUnlock()` の共通ハンドラから
  `unlockMatchCallAudio()` と並べて呼ぶ。
- `fireMatchCallAlert(speechText?: string): void` — 既存のチャイム・振動に加え、
  `speechText` があれば読み上げる。**チャイムを先に鳴らしてから読み上げる**
  （注意を引いてから内容を伝える。体育館の騒音下ではビープの方が通る）。
  チャイムは 0.3 秒なので `setTimeout` で 400ms 遅らせる。

### 3. 設定

**専用トグルは追加せず、既存の `matchCallAlert` に相乗りさせる。** ベル 1 つで
「音・振動・読み上げ」をまとめて ON/OFF する。読み上げだけ切りたい需要が出たら
その時に分ける。

ベルの OFF→ON 時のテスト再生でも読み上げを鳴らし、音声が出る端末か確認できる
ようにする。

### 4. 呼び出し側（`src/pages/MainPage.tsx`）

`buildNextMatchCallMessage` の `speech` を `fireMatchCallAlert(speech)` に渡す。
第3引数 `selfName` には `playerMap.get(myPlayerId)?.name` を渡す。`playerMap` は
`players` から作った `id → Player` の Map で既存のヘルパー（`getPlayerName` 等）
が使っているものと同じ。`myPlayerId` が `null` のときは渡さない（この呼び出し
経路は `shouldCallNextMatch` が `myPlayerId !== null` を確認した後にしか
実行されないため、実質的に常に渡る）。

## スコープ外

- **よみがなフィールドの追加**（登録名がカナ中心のため不要）
- **会場据え置き端末で全員分をアナウンスする使い方** — 通知の発火条件
  （現在は自分が対象のときのみ）を変える必要があり別設計。
- 音声の速度・音程・話者選択の UI。まず既定の音声で運用する。

## テスト

- `src/lib/nextMatchCall.test.ts` — `speech` の期待値を追加（名前あり/なし、
  記号入りの名前が除去されること、除去後に空になる名前が読み上げ対象から
  外れること）。既存の `body` / `toast` の期待値は変更しない。
- `src/lib/matchCallAlert.test.ts` — `speechSynthesis` を mock し、設定 OFF で
  発話しない / ON で `speak` が呼ばれる / `speechSynthesis` 未対応環境で
  throw しない / `speechText` 未指定なら発話しない。
