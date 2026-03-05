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

### 3. 開発サーバーで動作確認（推奨）
```bash
npm run dev
```
- ローカルで実際に動作確認
- UIの挙動、データフローを確認

**ルール：ビルドが通らないコードはmasterに入れない**
- GitHub Actionsでビルド失敗 = デプロイ失敗 = ユーザーに届かない
- ローカルで事前チェックして品質を保つ

## 🚨 デプロイポリシー

**修正したら必ずデプロイ**

- GitHub Pages で本番公開されるため、未デプロイ厳禁
- デプロイ忘れ = ユーザーに反映されない

## デプロイ手順（GitHub Actions）

**⚠️ `npm run deploy` は使わない！masterへのpushで自動デプロイ**

```bash
cd /home/gen/badminton-manager
git add -A
git commit -m "変更内容"
git push origin master
```

- masterにpushすると GitHub Actions が自動でビルド＆デプロイ
- 進捗確認: https://github.com/gen63/badminton-manager/actions
- 完了まで1〜2分程度

**デプロイ後:**
- Genにキャッシュバスティング付きURLを連携（タイムスタンプ付き）
- 形式: `https://gen63.github.io/badminton-manager/?t=UNIX_TIMESTAMP`
- 例: `https://gen63.github.io/badminton-manager/?t=1738227684`
- **バージョン番号を報告（vite.config.ts の __APP_VERSION__ を確認）**

## 📌 バージョン管理

**バージョン番号の場所:** `vite.config.ts` の `__APP_VERSION__`

現在のバージョン確認:
```bash
grep '__APP_VERSION__' vite.config.ts
```

**バージョン更新タイミング（手動）:**
- 機能追加時
- 重要なバグ修正時
- UI/UXの大きな変更時

## プロジェクト情報

- **リポジトリ:** https://github.com/gen63/badminton-manager
- **公開URL:** https://gen63.github.io/badminton-manager/
- **フレームワーク:** React + Vite + TypeScript
- **デプロイ:** GitHub Pages (gh-pages)
