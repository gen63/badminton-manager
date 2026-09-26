# 練習終了時刻と終了前の配置停止

## 背景
普段の練習は「終了20分前を過ぎたら新しい試合は入れない」「15分前で完全終了（片付け）」
という運用。アプリは練習開始時刻しか持っておらず、連続モードが ON のままだと終了間際でも
自動で次の試合が配置されてしまう。

## 方針
- `session.config.practiceEndTime?: number` を追加（Unix ms）。未設定・0 は機能オフ
  （旧セッション・手動作成セッションは従来どおり）。
- 段階は純粋関数 `src/lib/practiceEndPhase.ts` の `getPracticeEndPhase(end, now)`:
  `normal` / `lastCall`（残り20分以下）/ `closed`（残り15分以下）。
- **連続モード停止は transaction 内が本体**: `finishMatchAndContinue` が
  `config.practiceEndTime` を同じ snapshot から読み、`lastCall` 以降なら
  `skipContinuous` 相当で次の配置を見送り、`settings.continuousMatchMode=false` も同じ
  書き込みで落とす（どの端末から終了しても同じ判定。タイマーに依存しない）。
- 補助として、管理者端末は段階を跨いだ時点で `setContinuousMatchMode(false)` を書き、
  次の試合終了を待たずにトグル表示を実態に合わせる。`lastCall` 以降はトグルを ON に
  できない（延長したいときは設定画面で終了時刻を変える）。
- 手動の配置（一括・コート単位）は `lastCall` 以降 `window.confirm` で確認して許可
  （ぎりぎりまで回す日の逃げ道）。
- `lastCall` 以降は次の試合の予測を `EMPTY_PREDICTION` にする。予測バー・待機ガイド・
  4:30 呼び出し通知・管理者アナウンスが止まり、終了操作は担当不在のフォールバックで
  誰でも押せる。「N面まとめて配置します」バナーも出さない。
- 画面上部にバナー: `lastCall` は「⏰ ラスト（HH:MM〜）。新しい試合は入れません」、
  `closed` は「🏁 練習終了（HH:MM〜）。試合を終えて片付けをお願いします」。
  **プレイ中の試合は自動終了しない**（表示のみ）。誤った自動終了で履歴が汚れた前例
  （2026-09-08-auto-end-stale-timer）があり、人の終了操作に委ねる。
- 再描画は段階の切り替え時刻までの `setTimeout` 1本（`usePracticeEndPhase`）。

## 終了時刻の入力
- **自動作成**（`scripts/auto-create-session.ts`）: E-ToMo タイトル「18:30〜21:30」の
  終了側を `buildPracticeEndTime(practiceStartTime, endTime)` で `config.practiceEndTime`
  に入れる（開始以前になる時刻は翌日扱い）。再実行（名簿同期）時、`practiceEndTime` が
  undefined の既存セッションにだけ補完する。
- **設定画面**（管理者・コート設定カード先頭）: `PracticeEndTimeSetting` で変更・解除。
  解除はフィールド削除ではなく **0 を書く**（再実行の補完が管理者の解除を上書きしない
  よう、未設定 undefined と区別するため）。
- 手動作成（SessionCreate）は開始時刻も自動決定で入力 UI が無いので、終了時刻は持たない。
  必要なら設定画面で入れる。

## やらないこと
- 15分前でのプレイ中試合の自動終了。
- 終了時刻でのセッション自動退出・一覧非表示（既存の「最後の試合から30分」のまま）。
