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

## 同期ロジックのテスト

### テスト対象

- **`src/lib/syncUtils.ts`** - テスト可能な純粋関数として抽出
- **`src/lib/syncUtils.test.ts`** - 17個のテストケース

### テストケース

#### `getTimestampMillis()` - Firestoreタイムスタンプの変換

- ✅ 数値（ミリ秒）をそのまま返す
- ✅ null/undefinedの場合はnullを返す
- ✅ Firestore Timestamp型（toMillis）を変換
- ✅ Firestore Timestamp型（seconds）を変換
- ✅ 不明な形式の場合はnullを返す

#### `hashGameState()` - データのハッシュ計算

- ✅ 同じデータは同じハッシュを返す
- ✅ 異なるデータは異なるハッシュを返す

#### `shouldApplyRemoteData()` - リモートデータ適用判定

- ✅ 通常のケースでは適用する
- ✅ 自分がpushしたデータと同じならスキップ
- ✅ リモートデータが古い場合はスキップ
- ✅ リモートデータが同じ時刻の場合もスキップ
- ✅ 初回（lastAppliedRemoteUpdatedAt=0）の場合は適用する
- ✅ push直後（500ms以内）はスキップ
- ✅ push後500ms経過後は適用する
- ✅ pushBlockMsをカスタマイズできる
- ✅ 複数の条件が重なった場合、最初のスキップ条件が優先される
- ✅ タイムスタンプが同じでハッシュが異なる場合はスキップ

### テストカバレッジ

```bash
npm run test:coverage
```

主要なロジック部分は100%カバーされています。

## テスト駆動開発（TDD）

新しい同期ロジックを追加する場合：

1. **テストを先に書く** (`*.test.ts`)
2. **実装する** (`syncUtils.ts`)
3. **テストを通す**
4. **リファクタリング**

## E2Eテスト（今後）

現在は単体テストのみですが、以下のE2Eテストを追加予定：

- [ ] 2つのブラウザで同時操作
- [ ] ネットワーク遅延のシミュレーション
- [ ] オフライン→オンライン復帰
- [ ] 競合解決の動作確認

## CI/CD

GitHub Actionsでのテスト自動化を検討中。

## 参考

- [Vitest公式ドキュメント](https://vitest.dev/)
- [Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
