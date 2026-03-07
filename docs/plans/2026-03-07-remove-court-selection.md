# コート数選択UIの削除

## 概要

メイン画面でコート数を簡単に変更できるようになったため、セッション開始画面と設定画面からコート数選択UIを削除する。
開始時のコート数はデフォルト1とする。

## 変更内容

### SessionCreate.tsx
- コート数選択UI（1/2/3ボタン）を削除
- 初期コート数を3→1に変更
- `getRecommendedCourtCount()` の上限を固定値3に変更（Sheets読み込み時の自動調整は維持）

### SettingsPage.tsx
- コート数変更セクション（1/2/3ボタン + 使用中コート制約表示）を削除
- 関連する `handleCourtCountChange` 関数・未使用importを削除

## 変更しないもの

- MainPage.tsx のコート追加（+）・削除（−）ボタン
- MainPage.tsx の自動コート縮小ロジック（休憩時）
- SessionConfig型の courtCount フィールド
