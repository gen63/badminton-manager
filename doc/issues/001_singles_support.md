# Issue: シングルス対応の追加

## 概要
現在ダブルス専用となっているアプリにシングルス対応を追加する。

## 背景
- 現在の設計は4人でのダブルス（2ペア対戦）を前提としている
- シングルス練習のニーズにも対応したい

## 要件
- [ ] ゲームモード選択（シングルス/ダブルス）の追加
- [ ] シングルス用の配置アルゴリズム（2人の組み合わせ）
- [ ] コートへの2人配置対応
- [ ] シングルス用のスコア記録
- [ ] UI/UXの調整（シングルス時の表示）

## 関連するデータモデルの変更

### GameMode の追加
```typescript
type GameMode = 'singles' | 'doubles';
```

### Court インターフェースの変更
```typescript
interface Court {
  id: string;
  status: CourtStatus;
  gameMode: GameMode;           // 追加
  playerIds: string[];          // 2人（シングルス）または4人（ダブルス）
  pairA?: string[];             // ダブルス時のみ
  pairB?: string[];             // ダブルス時のみ
  startTime?: Date;
}
```

### Match インターフェースの変更
```typescript
interface Match {
  id: string;
  matchNumber: number;
  courtId: string;
  gameMode: GameMode;           // 追加
  playerIds: string[];          // 2人または4人
  pairA?: string[];             // ダブルス時のみ
  pairB?: string[];             // ダブルス時のみ
  score?: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
}
```

### SessionConfig インターフェースの変更
```typescript
interface SessionConfig {
  scoreType: ScoreType;
  courtCount: number;
  gameMode: GameMode;           // 追加: デフォルトのゲームモード
  allowMixedMode?: boolean;     // 追加: コートごとに異なるモードを許可
  createdAt: Date;
  lastAccessAt: Date;
  spreadsheetUrl?: string;
}
```

## 実装の考慮事項

### 配置アルゴリズム
- シングルス: 2人をレーティングが近い者同士でマッチング
- 待機時間と試合数のバランスは既存ロジックを流用

### UI変更
- セッション作成時にゲームモード選択を追加
- コート表示を2人/4人に対応
- メイン画面でのモード表示

## 参考
ドキュメント `doc/04_technical_spec.md` の「1.7 ペア固定モード」で将来実装として言及されている。

## 優先度
Medium（v2.0 での実装を想定）

---
作成日: 2026-01-30
