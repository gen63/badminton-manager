# バドミントンゲーム練習管理システム - ドキュメント

## 📚 ドキュメント一覧

このプロジェクトのドキュメントは、以下の6つのファイルに分割されています。

### 1. [概要](./01_overview.md)
プロジェクトの概要、目的、基本仕様

**内容**:
- プロジェクト概要
- 解決したい課題
- 基本仕様（デバイス、規模、データ管理）
- アクセスフロー

**読むべき人**: 全員（まず最初に読む）

---

### 2. [機能要件](./02_functional_requirements.md)
アプリの主要機能の詳細仕様

**内容**:
- 参加者管理
- レーティングシステム
- ゲーム設定
- コート配置とペア編成アルゴリズム
- ゲーム進行
- スコア入力と記録

**読むべき人**: 
- 機能を理解したい人
- アルゴリズムの詳細を知りたい開発者

---

### 3. [セッション管理と通知機能](./03_session_and_notification.md)
セッション管理、通知、リセット、履歴コピーの仕様

**内容**:
- セッション作成・入室フロー
- プッシュ通知（FCM + Web Audio）
- 練習リセット機能
- 履歴コピー機能

**読むべき人**: 
- セッション管理を実装する開発者
- 通知機能を実装する開発者

---

### 4. [技術仕様](./04_technical_spec.md)
Firebase、認証、データベース構造などの技術詳細

**内容**:
- 技術スタック（React + Firebase）
- Firebase Anonymous Authentication
- Firestore構造
- リアルタイム同期
- FCM通知システム
- エラーハンドリング

**読むべき人**: 
- 実装を担当する開発者
- インフラを設計する人

---

### 5. [画面設計](./05_screen_design.md)
全画面のUI/UX仕様

**内容**:
- 画面一覧（S01〜S07）
- 画面遷移図
- 各画面の詳細レイアウト
- 操作フロー

**読むべき人**: 
- UI/UXデザイナー
- フロントエンド開発者

---

### 6. [将来計画と運用](./06_future_and_operation.md)
将来的な拡張機能と運用ガイドライン

**内容**:
- 将来的な拡張機能（ログアーカイブ、承認機能、統計など）
- 運用上の注意点
- トラブルシューティング
- プロジェクトのまとめ

**読むべき人**: 
- プロダクトマネージャー
- 運用担当者
- ロードマップを考える人

---

## 🚀 クイックスタート

### 初めての人
1. [01_overview.md](./01_overview.md) を読む
2. [05_screen_design.md](./05_screen_design.md) でUIを確認
3. 必要に応じて他のドキュメントを参照

### 開発者
1. [01_overview.md](./01_overview.md) で全体像を把握
2. [04_technical_spec.md](./04_technical_spec.md) で技術仕様を確認
3. [02_functional_requirements.md](./02_functional_requirements.md) で機能詳細を理解
4. [05_screen_design.md](./05_screen_design.md) でUIを実装

### プロダクトマネージャー
1. [01_overview.md](./01_overview.md) で目的を確認
2. [02_functional_requirements.md](./02_functional_requirements.md) で機能を把握
3. [06_future_and_operation.md](./06_future_and_operation.md) でロードマップを検討

---

## 📝 ドキュメント更新履歴

| 日付 | バージョン | 変更内容 |
|------|----------|----------|
| 2026/01/29 | 1.0 | ドキュメント分割・整理 |
| 2026/01/29 | 0.9 | 通知機能、履歴コピー機能追加 |
| 2026/01/28 | 0.8 | Firebase前提に変更、技術仕様詳細化 |
| 2026/01/28 | 0.7 | セッション管理追加 |
| 2026/01/28 | 0.6 | 試合時間表示追加 |

---

## 🏗️ プロジェクト構成

```
docs/
├── README.md                          (このファイル)
├── 01_overview.md                     (概要)
├── 02_functional_requirements.md      (機能要件)
├── 03_session_and_notification.md     (セッション・通知)
├── 04_technical_spec.md               (技術仕様)
├── 05_screen_design.md                (画面設計)
└── 06_future_and_operation.md         (将来計画・運用)
```

---

## 🛠️ 技術スタック

このプロジェクトは以下の技術で実装されます:

### フロントエンド
- **React 18+** (TypeScript) - UIフレームワーク
- **Vite** - ビルドツール
- **PWA** - Progressive Web App
- **Tailwind CSS** - スタイリング
- **Zustand** - 状態管理
- **React Router v6** - ルーティング

### バックエンド
- **Firebase**
  - Firestore (Database)
  - Authentication (Anonymous Auth)
  - Cloud Functions (Node.js 20)
  - Cloud Messaging (FCM)
  - Hosting

詳細は [04_technical_spec.md](./04_technical_spec.md) を参照。

---

## 📧 お問い合わせ

ドキュメントに関する質問や提案は、プロジェクトリポジトリのIssueまで。

---

**プロジェクト名**: バドミントンゲーム練習管理システム  
**バージョン**: 1.0  
**最終更新**: 2026/01/29
