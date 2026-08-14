# 呼び出し通知: 1面運用時のコート番号省略

## 背景

`2026-08-14-match-call-speech.md` までの実装で、事前呼び出し通知の文言は
以下の3種で構成される。

- body: `3コート付近で試合終了をお待ちください\n太郎さん・花子さん`
- toast: `3コート付近で試合終了をお待ちください（太郎さん・花子さん）`
- speech: `太郎さん、花子さん。3コート付近で試合終了をお待ちください`

運用しているコートが1面だけのとき、「1コート」という番号は冗長である。
どのコートかは言うまでもないため、コート番号の部分を省く。

## 仕様

### `buildNextMatchCallMessage` の第1引数

`src/lib/nextMatchCall.ts` の `buildNextMatchCallMessage` 第1引数の型を
`courtNumber: number | null` にする。

```ts
export function buildNextMatchCallMessage(
  courtNumber: number | null,
  names: string[],
  selfName?: string,
): { body: string; toast: string; speech: string }
```

- `courtNumber` が `null` のとき: 見出し（headline）を `試合終了をお待ちください`
  にする
- `courtNumber` が数値のとき: 従来どおり `${courtNumber}コート付近で試合終了を
  お待ちください`

差し替えは headline のみ。名前の連結・区切り文字・speech の順序反転・
`selfName` の先頭寄せ・sanitize など、headline 以外の組み立てロジックは
変更しない。この差し替えは body / toast / speech の3つすべてに反映される
（読み上げだけでなく表示でも冗長なため）。

### 判断の所在

「コート番号を出すかどうか」は `buildNextMatchCallMessage` 自身は判断しない。
呼び出し側（`MainPage.tsx`）が運用コート数（`courts.length`。
`session.config.courtCount` と同期しており1〜3の範囲）を見て
`courts.length <= 1` なら `null` を渡す、という形で責務を持つ。builder は
「`null` = 番号を出さない指示」として素直に受け取るだけにする。

### `basisCourtId === null` との違い

`callBasisCourtId` が返す `null`（＝基準コートが特定できない）と、今回追加する
「コート番号を出さない」判断は別物である。

- `basisCourtId === null`: 呼び出しの基準コートそのものが決まらないケース。
  この場合は既存どおり通知そのものを出さずに `return` する（ガードは変更しない）。
- `courtNumberForMessage === null`: 基準コートは決まっている（`basisCourtId`
  は非 null）が、1面運用のため文言上は番号を見せない、という表示上の判断。
  通知自体は通常どおり出す。

`MainPage.tsx` では `basisCourtId === null` の既存ガードの**後**に、

```ts
// 運用コートが1面のみのときは「1コート」が冗長なので番号を出さない
const courtNumberForMessage = courts.length <= 1 ? null : basisCourtId;
```

として `buildNextMatchCallMessage` に渡す `courtNumberForMessage` を決める。

### ベルのテスト再生

ベルの OFF→ON テスト再生（`SPEECH_TEST_COURT` を使う経路）も、実際に聞こえる
文言と一致させるため同じ判定を通す。`SPEECH_TEST_COURT` をそのまま渡さず
`courts.length <= 1 ? null : SPEECH_TEST_COURT` を渡す。1面運用中の端末では
「ゆーたさん。試合終了をお待ちください」と読まれるのが正しい挙動になる。

## スコープ外

- コート番号の省略以外の文言変更
- 2面・3面運用時の文言（従来どおり番号を出す）

## テスト

- `src/lib/nextMatchCall.test.ts` — `courtNumber` に `null` を渡したとき
  body / toast / speech すべてで見出しが `試合終了をお待ちください` になる
  ことを名前あり・名前なしの両方で確認。`selfName` の先頭寄せが `null` でも
  従来どおり働くことも確認する。`courtNumber` が数値のときの既存の期待値は
  変更しない。
