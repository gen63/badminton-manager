# CLAUDE.md

## 開発ワークフロー

- 新機能・大きな変更の前に**必ず `plan` モードで計画**してから実装する
- 作成したplanは `docs/plans/YYYY-MM-DD-<機能名>.md` にコミットする
- コードベース探索前に `docs/plans/` の過去の設計意図を確認する

## コミット前チェック（必須）

以下を順番に実行し、すべて通ってからmasterにpush:

```bash
npm run build    # 型チェック + ビルド
npm run lint     # コードスタイル
npm run test:run # ユニットテスト
```

## 参照ドキュメント

- **DESIGN.md** - UIデザインガイドライン（デザイン変更時に必ず参照）
- **README.md** - プロジェクト概要、技術スタック
