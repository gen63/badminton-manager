# バドミントンマネージャー - プロジェクト設定

## 🎨 デザインルール

**デザインに関する修正・変更を行う際は、必ず `DESIGN.md` を参照すること**

- UI変更前に DESIGN.md を読み込む
- デザインルールに従った実装を行う
- ルールに記載のない新規要素は、既存のルールに準じて統一感を保つ

## ✅ コミット前の必須チェック

**masterにpushする前に必ず実行すること**

### 1. TypeScript型チェック + ビルドテスト
```bash
npm run build
```
- **ビルドエラーがあればmasterにpushしない**
- TypeScriptエラー、型の不整合をここで検出
- ビルド成功を確認してからコミット

### 2. リントチェック
```bash
npm run lint
```
- コードスタイルの統一
- 潜在的なバグを事前検出
- リントエラーのままmasterに入れない

### 3. Unit Tests実行
```bash
npm run test:run
```
- **テストが失敗したらmasterにpushしない**
- 配置アルゴリズム、ユーティリティ関数の動作確認
- テスト失敗時は修正してからコミット

### 4. 開発サーバーで動作確認（推奨）
```bash
npm run dev
```
- ローカルで実際に動作確認
- UIの挙動、データフローを確認

**ルール：ビルドとテストが通らないコードはmasterに入れない**
- GitHub Actionsでビルド失敗 = デプロイ失敗 = ユーザーに届かない
- テスト失敗 = ロジックの不具合 = バグの混入
- ローカルで事前チェックして品質を保つ

## 🚀 デプロイ手順

**masterへのpushで自動デプロイ（GitHub Actions）**

```bash
cd /home/gen/badminton-manager
git add -A
git commit -m "変更内容"
git push origin master
```

### デプロイの流れ
1. masterにpush
2. GitHub Actionsが自動でビルド＆デプロイ（1〜2分）
3. GitHub Pagesに公開

### デプロイ後の報告
- **バージョン番号**を報告（コミット数で自動算出）
  - 確認方法: `git rev-list --count HEAD`
  - 例: "Deployed version 606 to master"
- **キャッシュバスティング付きURL**を送信
  - 形式: `https://gen63.github.io/badminton-manager/?t=UNIX_TIMESTAMP`
  - 例: `https://gen63.github.io/badminton-manager/?t=1738227684`

### 進捗確認
- GitHub Actions: https://github.com/gen63/badminton-manager/actions

## 📁 ディレクトリ構造

```
badminton-manager/
├── docs/
│   └── plans/          # 設計ドキュメント・計画書
├── doc/                # 初期設計仕様書（アーカイブ）
├── e2e/                # E2Eテスト（Playwright）
├── src/
│   ├── components/     # 再利用可能なUIコンポーネント
│   ├── pages/          # ページコンポーネント
│   ├── stores/         # Zustand ストア
│   ├── hooks/          # カスタムフック
│   ├── lib/            # ユーティリティ・アルゴリズム
│   ├── services/       # Firebase等の外部サービス連携
│   └── types/          # TypeScript型定義
├── CLAUDE.md           # AI向けワークフロー指示
├── PROJECT.md          # プロジェクト設定（このファイル）
├── DESIGN.md           # UIデザインガイドライン
└── README.md           # プロジェクト概要
```

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
