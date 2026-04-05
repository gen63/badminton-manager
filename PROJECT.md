# バドミントンマネージャー - プロジェクト設定

## 🚀 デプロイ手順

**masterへのpushで自動デプロイ（GitHub Actions）**

1. masterにpush
2. GitHub Actionsが自動でビルド＆デプロイ（1〜2分）
3. GitHub Pagesに公開

### デプロイ後の報告

- **バージョン番号**: `git rev-list --count HEAD` で確認
- **キャッシュバスティング付きURL**: `https://gen63.github.io/badminton-manager/?t=UNIX_TIMESTAMP`

### 進捗確認

- GitHub Actions: https://github.com/gen63/badminton-manager/actions

## 📌 プロジェクト情報

- **リポジトリ:** https://github.com/gen63/badminton-manager
- **公開URL:** https://gen63.github.io/badminton-manager/
- **技術スタック:**
  - フレームワーク: React 19 + TypeScript
  - ビルド: Vite
  - スタイリング: Tailwind CSS 4
  - 状態管理: Zustand
  - ルーティング: React Router v7
- **デプロイ:** GitHub Pages (gh-pages branch)
- **バージョン:** コミット数で自動管理（`git rev-list --count HEAD`）
