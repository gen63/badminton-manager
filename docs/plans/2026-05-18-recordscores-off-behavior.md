# 勝敗記録モードOFF時の挙動整理

## 背景

`recordScores` ON/OFF の挙動が一部不揃いだった：

- **自動ダイアログ**: OFF時は表示しない（`UnrecordedMatchPrompt.tsx:53` で
  ゲート済み）✓
- **履歴タブの編集ボタン**: OFFのとき非表示 → 履歴からの手動入力経路が塞がれる
- **BottomNav の未入力バッジ**: OFFのときも matchHistory の winner=undefined
  を全部カウントして赤バッジ表示 → OFF設定の意味が薄い

ユーザー要望:
> 勝敗記録モードオフの時、勝敗を促すダイアログは自動表示しないが、
> 履歴タブからの入力は制限しない。
> またオフの時は履歴タブの未入力数の表示はオフとする。

## 方針

`recordScores=OFF` は「**終了時の自動プロンプト・通知バッジを出さない**」
モードと位置づける。手動入力の経路（履歴タブの編集）は塞がない。

| 機能 | OFF 時の挙動 | 備考 |
|------|------------|------|
| 自動ダイアログ (`UnrecordedMatchPrompt`) | 出さない | 変更なし、元々ゲート済み |
| BottomNav 履歴タブの未入力数バッジ | 出さない | **新規ゲート** |
| 各試合カードのオレンジ「未入力」バッジ | **表示** | OFF時でも個別の状態は分かるようにする |
| 履歴タブの編集ボタン | **常時表示** | OFF時も手動入力可能に |

「未入力数」というユーザー要望の語は BottomNav の数値バッジを指す。
各カードの「未入力」ラベル（状態表示）は数ではないので残す。

## 変更内容

### `src/pages/HistoryPage.tsx`
- `MatchCard` / `MatchList` の `recordScores` prop を削除（ゲートしなくなったため）。
- 編集ボタンを `recordScores && ...` 条件を外して常時表示に。
- `HistoryPage` の `useSettingsStore((s) => s.recordScores)` 参照を削除
  （他用途で使っていない）。

### `src/components/BottomNav.tsx`
- `useSettingsStore` import を追加。
- `unrecordedMatchesCount` の冒頭で `if (!recordScores) return 0;`。

### `src/pages/SettingsPage.tsx` / `src/pages/SessionCreate.tsx`
- OFF 時の説明文を「勝敗記録なし」→「終了時に勝敗を記録しない」に変更。
  OFF でも履歴から手動入力できる旨が誤解されないよう、ON 側の
  「終了時に勝敗を記録」と対称な表現に揃えた。

## 影響範囲

- 既存セッションで `recordScores=OFF` のとき：履歴バッジが消える、
  履歴タブの編集ボタンが見えるようになる。
- ON 時の挙動は変化なし。
- マイグレーション・データ形式変更なし（UI/表示のみ）。

## 検証

- `npm run build` / `npm run lint` / `npm run test:run` (351 件) 通過。
- 手動確認は本 PR では未実施（リモート実行環境のためブラウザ動作確認不可）。
  ローカルで以下を確認する：
  - OFF: 終了直後にダイアログが出ない / 履歴タブ赤バッジが消える /
    履歴の編集ボタンから ScoreInputPage に行ける。
  - ON: 既存挙動どおり（自動ダイアログ・バッジ・編集ボタンすべて表示）。
