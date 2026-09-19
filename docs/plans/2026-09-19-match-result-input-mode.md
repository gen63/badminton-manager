# 試合結果の入力方式を端末ごとに選べるようにする（matchResultInputMode）

日付: 2026-09-19

## 背景

試合終了後の未記録試合プロンプト（`UnrecordedMatchPrompt`）は、これまで常に
`WinnerSelectModal`（勝敗のみ選択）を出し、100-99 のダミースコアを書いていた。
点数まで残したい人（自分の記録を見返したい人・レーティング連携で細かく見たい人）
からは「点数入力ページ（`/score/:matchId`）を毎回自分で開くのが面倒」という要望が
あった。一方で大半の参加者にとっては勝敗のみの2タップが速く、全員を点数入力に
統一するのは体育館での回転を落とす。

よって **セッション全体ではなく個人（端末）ごとに選べる設定** にする。

## 確定仕様

- 設定名: `matchResultInputMode: 'simple' | 'score'`、既定値 `'simple'`。
- 保存先は **端末ローカル**（`settingsStore` の `partialize` に追加 = localStorage）。
  Firestore には同期しない。端末ごとに違って良い設定であり、他人の入力方式を
  勝手に変えてはいけないため。
- 既存の `recordScores`（Firestore 同期・セッション共有の「結果を記録するか」の
  ON/OFF）とは **独立した別軸**。`recordScores` が OFF のときは従来どおり
  プロンプト自体を出さない（分岐は `recordScores` ON が前提）。
- `UnrecordedMatchPrompt` の分岐:
  - `'simple'`（既定）: 現行どおり `WinnerSelectModal` を表示し、100-99 の
    ダミースコアを書く。**既存ユーザーから見た挙動は完全に不変**。
  - `'score'`: モーダルを出さず `/score/:matchId` へ `navigate` する。
    遷移時に `state.from = '/main'` を渡し、`ScoreInputPage` の戻り先を
    メイン画面にする（プロンプトの発生源は `MainPage`）。
- 無限ループ防止: 遷移の直前に既存のスヌーズ機構
  （`unrecordedDismissStore.dismiss`、既定 10 分）で当該 matchId を抑制する。
  入力して戻れば `scoreA/scoreB` が入って対象から外れ、入力せず戻っても
  10 分間は再発火しない。
- 設定 UI: `SettingsPage` の「この端末の設定」セクション（`finishHoldToConfirm`
  の直後）に、既存の `select-button` 2ボタン + 説明文パターンで追加。
  説明文で「セッションの設定」の試合記録モードとは別物だと明示する。

## 却下案

- **点数入力をモーダル化して `UnrecordedMatchPrompt` 内に埋め込む**: 見た目の
  一貫性は上がるが、`ScoreInputPage` はページ前提のレイアウト・`useParams` /
  `useNavigate` 依存・削除/離脱などの導線を持っており、モーダル化すると
  実装の二重化かページ側の大改修が必要になる。入力方式の選択という小さな
  目的に対して割に合わないため、既存ページをそのまま再利用する方式にした。
- **セッション共有設定にする**: 「慣れた1人が詳細にしたら全員が点数入力」に
  なり回転が落ちる。`finishHoldToConfirm` と同じ理由で端末ローカルにした。

## 影響範囲

- `src/stores/settingsStore.ts` — state/setter 追加、`partialize` に列挙。
  migrate は不要（新規キーは未定義なら既定値 `'simple'`）。
- `src/components/UnrecordedMatchPrompt.tsx` — モード分岐と遷移＋スヌーズ。
- `src/pages/SettingsPage.tsx` — 端末設定のトグル追加。
- テスト: `src/stores/settingsStore.test.ts`（persist 対象の検証）、
  `src/components/UnrecordedMatchPrompt.test.tsx`（新規・分岐）。
- 非対象: `ScoreInputPage` の内部ロジック、`Match` 型、Firestore 同期、GAS 送信。
