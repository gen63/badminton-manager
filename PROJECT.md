# バドミントンマネージャー - プロジェクト設定

## 🚨 デプロイポリシー

**修正したら必ずデプロイ**

- 変更後は即座に `npm run deploy` を実行
- GitHub Pages で本番公開されるため、未デプロイ厳禁
- デプロイ忘れ = ユーザーに反映されない

## デプロイ手順

```bash
cd /home/gen/badminton-manager
git add .
git commit -m "変更内容"
git push origin master
npm run deploy
```

## プロジェクト情報

- **リポジトリ:** https://github.com/gen63/badminton-manager
- **公開URL:** https://gen63.github.io/badminton-manager/
- **フレームワーク:** React + Vite + TypeScript
- **デプロイ:** GitHub Pages (gh-pages)
