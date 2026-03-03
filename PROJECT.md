# バドミントンマネージャー - プロジェクト設定

## 🎨 デザインルール

**デザインに関する修正・変更を行う際は、必ず `DESIGN.md` を参照すること**

- UI変更前に DESIGN.md を読み込む
- デザインルールに従った実装を行う
- ルールに記載のない新規要素は、既存のルールに準じて統一感を保つ

## ✅ コードチェック

**commit/push前に必ずlintを実行**

```bash
npm run lint
```

- エラーがある場合は修正してからcommit
- GitHub Actionsでもlintは実行されるが、**事前確認で品質を保つ**
- リントエラーのままmasterに入れない

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

## プロジェクト情報

- **リポジトリ:** https://github.com/gen63/badminton-manager
- **公開URL:** https://gen63.github.io/badminton-manager/
- **フレームワーク:** React + Vite + TypeScript
- **デプロイ:** GitHub Pages (gh-pages)
