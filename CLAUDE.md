# CLAUDE.md

このファイルはClaude Code向けのプロジェクト指示書です。

---

## 🎯 開発ワークフロー（必須）

### 1. Plan First（計画優先）

新機能・大きな変更の前に**必ず `plan` モードを使う**。
いきなりコードを書かない。

```
/plan <やりたいこと>
```

### 2. Planの保存

作成したplanは `docs/plans/` 配下にMarkdownでコミットする。

- ファイル名: `YYYY-MM-DD-<機能名>.md`
- 例: `2026-02-03-court-allocation-v2.md`

### 3. 探索時のplan参照

コードベースを探索する前に、**まず `docs/plans/` を確認**。
過去の設計意図・決定事項を把握してから作業する。

```
# 作業開始時のルーティン
1. docs/plans/ を読む
2. 関連する過去のplanがあれば内容を理解
3. その上でコードを探索・修正
```

---

## 📁 ディレクトリ構造

```
badminton-manager/
├── docs/
│   └── plans/          # 設計ドキュメント・計画書
├── src/
│   ├── components/     # 再利用可能なUIコンポーネント
│   ├── pages/          # ページコンポーネント
│   ├── stores/         # Zustand ストア
│   ├── hooks/          # カスタムフック
│   ├── lib/            # ユーティリティ・アルゴリズム
│   └── types/          # TypeScript型定義
└── DESIGN.md           # UIデザインガイドライン
```

---

## 🛠️ 技術スタック

- **フレームワーク**: React + TypeScript
- **ビルド**: Vite
- **スタイリング**: Tailwind CSS
- **状態管理**: Zustand
- **デプロイ**: GitHub Pages (GitHub Actions)

---

## 📐 デザインルール

`DESIGN.md` を参照。特に重要なポイント：

- タップターゲット: 44px以上
- 画面端余白: 20px以上（`p-5`）
- iOS Safari対応必須

---

## ⚠️ 注意事項

- PRを作成する前にローカルでビルド確認: `npm run build`
- コミットメッセージは日本語OK
