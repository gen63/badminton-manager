# 単モード（シングルス）が配置アルゴリズムに反映されないバグ修正

作成日: 2026-04-20
対応ブランチ: `claude/fix-single-mode-three-players-yCFwG`

## 症状

- 単モード（`practiceType === '単'`）にしていても、3人で試合配置ができない
- 単モードなのにコートに4人配置しようとする

## 根本原因

`SessionCreate.tsx` / `SettingsPage.tsx` で単モードを指定する UI は
`useSettingsStore.practiceType` を `'単' | '複' | '楽'` で持つだけで、
`Session.config.gameMode: 'singles' | 'doubles'` には一切書き込まれていない。

`MainPage.tsx` では次のようにゲームモードを決定している:

```ts
const gameMode = session?.config.gameMode ?? 'doubles';
```

`gameMode` が保存される箇所がないため常に `'doubles'` にフォールバックし、
`assignCourts` は1コートあたり4人必要なダブルス経路を通ってしまう。
結果、3人だと `insufficient-players` で失敗する。

## 方針

最小変更で UI 側の選択と配置アルゴリズムを整合させる。
`practiceType` は `useFirebaseSync` 経由で `gameState.settings.practiceType`
として同期されるため、全ユーザーで同じ値を参照できる。

1. `src/lib/gameOperations.ts` に純粋関数
   `gameModeFromPracticeType(practiceType)` を追加:
   - `'単'` → `'singles'`
   - その他 (`'複' | '楽' | undefined`) → `'doubles'`
2. `src/pages/MainPage.tsx` の `gameMode` 決定箇所 (4カ所) を
   `session?.config.gameMode ?? gameModeFromPracticeType(practiceType)` に変更。
   - 既存の `session.config.gameMode` を優先（将来的に明示保存されたとき用）
   - 無ければ `practiceType` から導出
3. `src/lib/algorithm.test.ts` にシングルス配置のリグレッションテストを追加:
   - 3人 / 1コート / 単モード → 2人配置
   - コート数 × 2 人未満の場合のみ `insufficient-players` を投げる

## 非対象

- `Session.config.gameMode` を UI から明示的に書き込む機能追加
- `CourtAssignment` の型 (`[string, string]`) のシングルス対応リファクタ
  （現行の空文字パディング方式を維持）
- ScoreInputPage / HistoryPage の表示ロジック（既に試合データの
  `teamA[1] === ''` で判定しており影響なし）
