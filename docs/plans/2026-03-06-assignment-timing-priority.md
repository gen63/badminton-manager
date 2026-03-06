# 連続モードOFF時の配置優先モード設定

## Context
10人2コートで1コートだけ終了した場合、待機2人+終了4人=6人から4人選んでも実質2人しか入れ替わらず流動性が低い。一方、回数を優先したい場面もある。設定で選択可能にする。

## 設定: 配置タイミング

- **回数優先**（デフォルト）: 従来通り、空きが出たら即座に配置
- **流動優先**: 連続モードOFF時、過半数のコートが終了するまで配置をブロック

流動優先の条件: `shouldBlock = playingCourts > 0 && emptyCourts <= playingCourts`

| シナリオ | 空き | 試合中 | 空き > 試合中 | 流動優先時 |
|---|---|---|---|---|
| 10人/2コート, 1コート終了 | 1 | 1 | No | ブロック |
| 10人/2コート, 全コート終了 | 2 | 0 | Yes | 許可 |
| 14人/3コート, 1コート終了 | 1 | 2 | No | ブロック |
| 14人/3コート, 2コート終了 | 2 | 1 | Yes | 許可 |

回数優先時は全て許可（従来通り）。

## 変更対象

### 1. `src/stores/settingsStore.ts`
- `prioritizeRotation: boolean` を追加（デフォルト: `false`）
- setter `setPrioritizeRotation` を追加

### 2. `src/pages/SettingsPage.tsx`
- 既存の「配置モード」セクションの下に「配置タイミング」トグルを追加
- 回数優先 / 流動優先 の2ボタン（既存UIパターンに合わせる）

### 3. `src/pages/MainPage.tsx`
- `prioritizeRotation` を settingsStore から取得
- `shouldBlockAssignment` を算出:
  ```
  const shouldBlockAssignment = prioritizeRotation && !continuousMatchMode
    && playingCourts.length > 0 && emptyCourts.length <= playingCourts.length;
  ```
- `canAutoAssign` に `&& !shouldBlockAssignment` を追加
- ブロック時、空きコートに「試合終了を待機中...」メッセージ表示
- ヘッダーの一括ボタン横に「他コート終了後に配置」テキスト表示

## 検証
- `npm run lint` 成功
- `npm run build` 成功
