# 後半均等化の自動ON を「練習終了の60分前」へ

## 背景
2.5h 練習でラスト15分が休憩の場合、従来の「練習開始 + 120分」で自動ONすると実効15分しか後半均等化が効かない。

## 変更
- `session.config.practiceEndTime` がある場合は `practiceEndTime - 60分` に自動ON。
- 無い旧セッションは従来通り `practiceStartTime + 120分`。
- 発火時刻は純粋関数 `getLateBalanceAutoOnTime`（`src/lib/lateBalanceAutoOn.ts`）に切り出し、Vitest で検証。
- MainPage の useEffect 依存に `practiceEndTime` を追加。設定画面の説明文を「練習終了の60分前に自動的にONになります」に変更。
- 併せて設定画面のセッションQR・URLカードから説明文とURL文字列表示を削除（QRとコピーボタンは維持）。
