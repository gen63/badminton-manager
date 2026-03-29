# シングルスモードの追加

作成日: 2026-03-10

## 概要

現在ダブルス専用のアプリにシングルス対応を追加する。
セッション単位でゲームモード（シングルス/ダブルス）を選択可能にする。

## 参照

- `doc/issues/001_singles_support.md` - 元の要件定義

## 設計方針

### データモデル

**最小変更アプローチ**: 既存の `teamA: [string, string]` / `teamB: [string, string]` 構造を維持し、シングルス時は2番目の要素を空文字列にする。

```typescript
type GameMode = 'singles' | 'doubles';

// SessionConfig に追加
interface SessionConfig {
  // ...existing fields
  gameMode: GameMode;  // デフォルト: 'doubles'
}
```

**理由**:
- TypeScript の型変更を最小限に抑える
- 既存コードは空文字列の処理を既にサポート
- Match/Court の型変更不要
- 既存データとの後方互換性を維持

### 変更箇所

1. **型定義** (`types/session.ts`): `GameMode` 型追加、`SessionConfig.gameMode` 追加
2. **セッション作成** (`pages/SessionCreate.tsx`): ゲームモード選択UI追加
3. **配置アルゴリズム** (`lib/algorithm.ts`): シングルス用配置（2人選出）
4. **メイン画面** (`pages/MainPage.tsx`): シングルス用コート表示（1v1）
5. **試合履歴** (`pages/HistoryPage.tsx`): シングルス対応表示
6. **スコア入力** (`pages/ScoreInputPage.tsx`): 2人表示対応
7. **勝者選択** (`components/WinnerSelectModal.tsx`): 1人選択対応
8. **ユーティリティ** (`lib/utils.ts`): コート推奨数の計算調整

### アルゴリズム変更

シングルスモード時:
- 1コートあたり2人を選出
- レーティングに基づくマッチング（近い者同士）
- 優先度計算は既存ロジックを流用
- 直近試合の重複チェックは2人の組み合わせに変更
- 性別バランスは不要

### UI変更

- セッション作成時にゲームモード選択を追加
- コート表示: 1v1レイアウト（プレイヤー名が1つずつ）
- 試合履歴: 1v1形式で表示
- スコア入力: 2人のみ表示
