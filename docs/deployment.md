# 本番反映（デプロイ）手順

本アプリの**本番環境は GitHub Pages** で、URL は
**https://gen63.github.io/badminton-manager/** です。

## 仕組み（要点）

- **`master` ブランチへの push をトリガーに GitHub Actions が自動デプロイ**する。
  ワークフロー: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)
  （name: `Deploy to GitHub Pages`）。
- ワークフローは `build` → `deploy` の 2 ジョブ:
  1. `build`: `npm ci` → `npm run build` して `dist/` を Pages アーティファクトに
     アップロード（`actions/upload-pages-artifact`）。
  2. `deploy`: `actions/deploy-pages` で GitHub Pages に反映。
- **バージョンはコミット数から自動採番**される（`1.0.<git rev-list --count HEAD>`）。
  画面下部の `v1.0.NNN` 表示がこれ。手動で `package.json` の version を上げる必要はない。
- **Firebase の環境変数はビルド時に GitHub Actions Secrets から注入**される
  （`VITE_FIREBASE_*` / `VITE_DISCORD_WEBHOOK_URL`）。ローカルの `.env` は本番ビルドには
  使われない。Secrets は Firebase console / リポジトリ設定側で管理。

> 補足: `package.json` に `npm run deploy`（`gh-pages -d dist`）が残っているが、
> これは旧来のローカル手動デプロイ用。**本番の正規経路は上記の Actions（master push）**
> であり、通常はこちらを使うこと。手動 `gh-pages` push は Pages の公開ソースと
> 競合しうるため、原則使わない。

## 本番反映の標準フロー（PR マージ運用）

このリポジトリは **全変更を PR 経由で `master` にマージする運用**（`master` の履歴は
すべて "Merge pull request …"）。本番反映は次の手順で行う。

1. 作業ブランチ（例 `claude/<topic>` や feature ブランチ）で実装・コミット。
2. **コミット前チェック（必須／CLAUDE.md）を全て通す**:
   ```bash
   npm run build    # 型チェック + ビルド
   npm run lint     # コードスタイル
   npm run test:run # ユニットテスト
   ```
3. 最新 `master` を取り込む（`git fetch origin master` → 作業ブランチを
   `origin/master` に rebase）。競合が無いこと・チェックが通ることを再確認。
4. 作業ブランチを push し、**`master` 向けの PR を作成**。
5. PR を **`master` にマージ**（merge commit 運用）。
   → このマージ push で `Deploy to GitHub Pages` が自動起動する。
6. **デプロイ完了を確認**する:
   - GitHub の Actions → `Deploy to GitHub Pages` の最新 run が `success` になること。
   - 本番 URL https://gen63.github.io/badminton-manager/ を開き、画面下部の
     `v1.0.NNN` が想定バージョン（＝新しいコミット数）に更新されていること。

## ロールバック

問題があった場合は、**`master` 上で当該変更を revert する PR を作成 → マージ**すれば、
同じ自動デプロイ経路で以前の状態に戻せる（本番は常に `master` の内容）。

## 関連

- 開発ワークフロー全般 / コミット前チェック: [`../CLAUDE.md`](../CLAUDE.md)
- プロジェクト概要・技術スタック: [`../README.md`](../README.md)
