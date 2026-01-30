# バドミントンマネージャー - プロジェクト設定

## 🎨 デザインルール

**デザインに関する修正・変更を行う際は、必ず `DESIGN.md` を参照すること**

- UI変更前に DESIGN.md を読み込む
- デザインルールに従った実装を行う
- ルールに記載のない新規要素は、既存のルールに準じて統一感を保つ

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

**デプロイ後:**
- Genにキャッシュバスティング付きURLを連携（タイムスタンプ付き）
- 形式: `https://gen63.github.io/badminton-manager/?t=UNIX_TIMESTAMP`
- 例: `https://gen63.github.io/badminton-manager/?t=1738227684`

## プロジェクト情報

- **リポジトリ:** https://github.com/gen63/badminton-manager
- **公開URL:** https://gen63.github.io/badminton-manager/
- **フレームワーク:** React + Vite + TypeScript
- **デプロイ:** GitHub Pages (gh-pages)
