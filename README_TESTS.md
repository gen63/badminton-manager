# テストガイド

## テストの実行

```bash
# 全テスト実行（ウォッチモード）
npm test

# 特定のテストファイルを実行
npm test -- syncUtils.test.ts

# 1回だけ実行（CI用）
npm run test:run

# UIモード
npm run test:ui

# カバレッジ
npm run test:coverage
```

## テスト対象ファイル一覧

### 1. 配置アルゴリズム — `src/lib/algorithm.test.ts`（35ケース）
- 待機時間優先・試合回数優先の配置ロジック
- グルーピング（上位/中位/下位）
- 性別バランス、ペア履歴・対戦履歴の考慮

### 2. ユーティリティ — `src/lib/utils.test.ts`（30ケース）
- CSS class結合（cn）、日時フォーマット
- セッションID生成、コート数推奨
- 配置ブロック判定

### 3. 同期ロジック — `src/lib/syncUtils.test.ts`（17ケース）
- Firestoreタイムスタンプ変換（getTimestampMillis）
- データハッシュ計算（hashGameState）
- リモートデータ適用判定（shouldApplyRemoteData）

### 4. セッション・お知らせ — `src/stores/sessionStore.test.ts`（17ケース）
- お知らせ機能（テキスト保存、Firestore同期）
- Information モーダル状態同期
- 既読管理（readBy トラッキング）

### 5. 同期シナリオ — `src/hooks/useFirebaseSync.test.ts`（4ケース）
- 2クライアント同時更新、push完了後の受信
- ネットワーク遅延、エコーバック

### 合計: 103テスト

### テストカバレッジ

```bash
npm run test:coverage
```

## E2Eテスト

E2Eテスト（Playwright）は既に実装済み。詳細は `README_E2E.md` を参照。

## CI/CD

GitHub Actionsでmasterへのpush時に自動ビルド＆デプロイを実行。

## 参考

- [Vitest公式ドキュメント](https://vitest.dev/)
- [Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
