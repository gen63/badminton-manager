# E2Eテストガイド（同期専用）

## 概要

Firebase同期の動作を検証するためのPlaywright E2Eテストです。
**同期関連の修正後に手動で実行**して、実際の動作を確認します。

## セットアップ

```bash
# Playwrightブラウザをインストール（初回のみ）
npx playwright install chromium
```

## テストの実行

### 通常実行

```bash
npm run test:e2e
```

### UIモード（デバッグ推奨）

```bash
npm run test:e2e:ui
```

UIモードでは以下が可能：
- テストを1つずつ実行
- 各ステップを目視で確認
- スクリーンショットを確認
- 失敗箇所を詳細に調査

### デバッグモード

```bash
npm run test:e2e:debug
```

ブレークポイントを設定し、ステップ実行が可能。

## テストケース

### `e2e/sync.spec.ts` - Firebase同期テスト

#### ✅ テスト1: ブラウザAで休憩→ブラウザBに即座に反映

- ブラウザA: プレイヤーを休憩
- ブラウザB: 1秒以内に休憩が反映されることを確認

#### ✅ テスト2: ブラウザAで休憩復帰→ブラウザBに即座に反映

- ブラウザA: プレイヤーを休憩 → 復帰
- ブラウザB: 1秒以内に復帰が反映されることを確認

#### ✅ テスト3: ブラウザAとBで同時に操作→競合せず両方反映

- ブラウザA: 1人目を休憩
- ブラウザB: 2人目を休憩（ほぼ同時）
- 両方で2人が休憩状態になることを確認

#### ✅ テスト4: 古いデータで上書きされない

- ブラウザA: 休憩 → 復帰
- ブラウザB: 最新状態（復帰）が保たれる
- 2秒待機しても古い「休憩」状態に戻らないことを確認

#### ✅ テスト5: PWAとブラウザ間でも同期が動作

- ブラウザA: 通常モード
- ブラウザB: PWAモード（モバイルサイズ）
- 両方で同期が動作することを確認

## 実行タイミング

### 必ず実行すべき場合

- ✅ Firebase同期ロジックを修正した後
- ✅ useFirebaseSync.ts を変更した後
- ✅ syncUtils.ts を変更した後
- ✅ Firestore Transaction処理を変更した後

### 推奨される場合

- ストア（Zustand）の構造を変更した後
- 大きなリファクタリングの後

### 不要な場合

- UIのみの変更（色、レイアウト等）
- Unit Testで十分な変更

## テスト結果の確認

### 成功時

```
✅ 休憩の同期成功
✅ 復帰の同期成功
✅ 同時操作の競合解決成功
✅ タイムスタンプによる古いデータ拒否成功
✅ PWA同期成功

5 passed
```

### 失敗時

- `playwright-report/index.html` を開く
- スクリーンショット、動画、トレースを確認
- コンソールログで詳細を確認

## CI/CDでの自動化（オプション）

GitHub Actionsでの自動化は現在**無効**です。

理由：
- E2Eテストは実行時間が長い
- Firebaseの認証情報が必要
- UI変更でフレイキーになりやすい

必要に応じて `.github/workflows/e2e.yml` を作成できます。

## トラブルシューティング

### テストが失敗する場合

1. **ローカルでdevサーバーが起動しているか確認**
   ```bash
   npm run dev
   ```

2. **Firebaseの設定が正しいか確認**
   - `.env` にFirebase設定があるか
   - Firestoreのルールが正しいか

3. **ブラウザが古い場合**
   ```bash
   npx playwright install chromium --force
   ```

4. **ポート5173が使用中の場合**
   - `playwright.config.ts` の `baseURL` を変更

### デバッグのコツ

- `npm run test:e2e:ui` でUIモードを使用
- `page.pause()` を挿入してブレークポイントを設定
- `--headed` オプションでブラウザを表示
  ```bash
  npx playwright test --headed
  ```

## 参考

- [Playwright公式ドキュメント](https://playwright.dev/)
- [Playwrightベストプラクティス](https://playwright.dev/docs/best-practices)
