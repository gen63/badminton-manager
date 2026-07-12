# 連続モードが ON 表示なのに効かないバグの修正

## 症状

連続モードのトグルが ON 表示なのに、試合終了後の自動配置が行われないことがある。

## 原因

`gameState.settings.continuousMatchMode` が Firestore document に**存在しない**
セッションで、UI 表示と試合終了トランザクションの解釈が食い違う:

- **UI**: `settingsStore` のデフォルトが `continuousMatchMode: true`。
  `useFirebaseSync` はリモートに値がある時
  （`settings.continuousMatchMode !== undefined`）しかローカルを更新しないため、
  フィールド欠損時はデフォルトの `true` が残り、トグルは **ON 表示**になる。
- **トランザクション**: `finishMatchAndContinue`（`sessionMutations.ts`）は
  `remoteSettings?.continuousMatchMode ?? false` でフィールド欠損を **OFF 扱い**。
  → 自動配置は行われない。

フィールドが欠損する経路は**オート作成セッション**
（`scripts/auto-create-session.ts` の `buildSessionData`）。初期 settings に
`practiceType` / `recordScores` しか書いておらず、`continuousMatchMode` が無い。
手動作成（`SessionCreate.tsx`）は書いているため発生しない。

誰かがトグルを一度 OFF→ON するとフィールドが書かれて以後は正常に動く。
「効かないことが**ある**」という再現性の低さはこれで説明できる。

## 修正内容

1. **`scripts/auto-create-session.ts`**: `buildSessionData` の初期 settings に
   `continuousMatchMode: true` を追加（手動作成時のデフォルト＝
   `settingsStore` の初期値 `true` と揃える）。
2. **`src/hooks/useFirebaseSync.ts`**: `continuousMatchMode` の同期を
   `lateBalanceMode` と同じ「欠損は `false` 扱い」方式に変更
   （`gameState.settings?.continuousMatchMode ?? false`）。
   これにより、既にフィールド欠損状態で走っている既存セッションでも
   「トグル表示＝トランザクションの実効値」が常に一致する
   （欠損時は OFF 表示になり、ユーザーが ON にすればフィールドが書かれる）。

トランザクション側のフォールバック（`?? false`）は変更しない。
`?? true` に変えると既存の欠損セッションで連続モードが勝手に ON になる
挙動変更を伴うため、表示側を実効値に合わせる方向で統一する。

`settingsStore` のデフォルト `true` は変更しない（`SessionCreate` が
セッション作成時の初期値として参照しており、製品デフォルト ON は維持）。

## テスト

- `scripts/auto-create-session.test.ts`: 初期 settings に
  `continuousMatchMode: true` が含まれることを検証。
- `src/hooks/useFirebaseSync.test.ts`: リモート settings に
  `continuousMatchMode` が無い場合、ローカルが `false` に同期されることを検証。

## 検証

```bash
npm run build && npm run lint && npm run test:run
```
