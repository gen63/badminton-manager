# シングルス対応実装プラン

## 📋 概要
現在ダブルス専用となっているバドミントンマネージャーに、シングルスモード（1対1）を追加する。

**目的:**
- シングルス練習のニーズに対応
- ダブルスとシングルスを選択可能に
- 既存のダブルス機能は完全に維持

**対象バージョン:** v2.0  
**優先度:** Medium  
**推定工数:** 6-8時間

---

## 🎯 要件定義

### 機能要件
- [x] ゲームモード選択（シングルス/ダブルス）の追加
- [ ] シングルス用の配置アルゴリズム（1対1マッチング）
- [ ] コートへの2人配置対応
- [ ] シングルス用のスコア記録
- [ ] UI/UX調整（シングルス時の表示）
- [ ] Firebase同期対応

### 非機能要件
- 既存ダブルス機能への影響ゼロ（下位互換性）
- TypeScript型安全性の維持
- テストカバレッジの維持
- デザインシステムへの準拠（DESIGN.md）

---

## 🏗️ 設計判断

### 1. 型設計の方針

#### ✅ 採用: 配列型に統一（選択肢A）

**理由:**
- 既存コード18ファイルでの `[string, string]` タプル使用
- 柔軟性と実装コストのバランス
- 将来的な拡張性（3人制など）

**変更内容:**
```typescript
// Before (現状)
interface Court {
  teamA: [string, string];
  teamB: [string, string];
}

// After (シングルス対応)
interface Court {
  id: number;
  gameMode: 'singles' | 'doubles';
  teamA: string[];  // length 1 (singles) or 2 (doubles)
  teamB: string[];
  // 既存フィールド維持
}
```

**型安全性の確保:**
```typescript
// ヘルパー関数でランタイムチェック
function isValidTeam(team: string[], gameMode: GameMode): boolean {
  const expectedLength = gameMode === 'singles' ? 1 : 2;
  return team.length === expectedLength && team.every(id => id !== '');
}
```

### 2. データモデル定義

#### src/types/session.ts
```typescript
export interface SessionConfig {
  courtCount: number;
  targetScore: number;
  practiceDate: string;
  practiceStartTime: number;
  gym?: string;
  gameMode: 'singles' | 'doubles';  // 追加（デフォルト: 'doubles'）
}
```

#### src/types/court.ts
```typescript
export interface Court {
  id: number;
  gameMode: 'singles' | 'doubles';  // 追加
  teamA: string[];  // [id] or [id1, id2]
  teamB: string[];
  scoreA: number;
  scoreB: number;
  isPlaying: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  restingPlayerIds?: string[];
}

export interface CourtAssignment {
  courtId: number;
  gameMode: 'singles' | 'doubles';  // 追加
  teamA: string[];
  teamB: string[];
}
```

#### src/types/match.ts
```typescript
export interface Match {
  id: string;
  courtId: number;
  gameMode: 'singles' | 'doubles';  // 追加
  teamA: string[];  // 2 or 4 players
  teamB: string[];
  scoreA: number;
  scoreB: number;
  startedAt: number;
  finishedAt: number;
  winner?: 'A' | 'B';
}
```

### 3. アルゴリズム設計

#### シングルス配置ロジック

**方針: レーティングが近い者同士をマッチング**

```typescript
// src/lib/algorithm.ts に追加
export function assignCourtsSingles(
  players: Player[],
  courtCount: number,
  matchHistory: Match[],
  options?: {
    practiceStartTime?: number;
    useStayDurationPriority?: boolean;
  }
): CourtAssignment[] {
  /*
  基本方針:
  1. レーティング順に並べる（連勝/連敗調整済み）
  2. 待機時間優先でソート
  3. 上から2人ずつペアリング
  4. レーティング近い者同士が対戦
  */
}
```

**既存ロジックの流用:**
- `buildInitialOrder()` - レーティング順序列
- `applyStreakSwaps()` - 連勝/連敗調整
- `calculatePriorityScore()` - 待機時間優先度

**シングルス特有の処理:**
- ペアリングアルゴリズム: 2人ずつマッチング
- 性別バランス: 無視（シングルスでは不要）
- 予約対応: 2人予約 → 固定シングルス試合

### 4. 既存機能との互換性

#### 予約機能
**対応方針:**
- ✅ 2人予約: シングルス固定試合として配置
- ❌ 3-4人予約: ダブルス専用（シングルスでは無効）
- ✅ 1人予約: 優先的にマッチング相手を選出

#### 連続モード
**対応方針:**
- ✅ シングルスでも有効
- 勝者残留ロジックは同じ（ローテーション不要）

#### 性別バランス
**対応方針:**
- ❌ シングルスでは無視
- ダブルスのみ男女ペア推奨を継続

#### Firebase同期
**対応方針:**
- `gameMode` フィールドを追加
- **マイグレーション戦略:**
  ```typescript
  // 既存セッション（gameMode未設定）
  const gameMode = session.config.gameMode ?? 'doubles';
  ```
  - 既存データは自動的に 'doubles' として扱う
  - 新規セッションは明示的に指定

---

## 🎨 UI/UX設計

### 1. セッション作成画面（SessionCreate.tsx）

**追加要素:**
```tsx
<div className="space-y-2">
  <label className="block text-sm font-medium">ゲームモード</label>
  <div className="grid grid-cols-2 gap-3">
    <button
      onClick={() => setGameMode('doubles')}
      className={`btn ${gameMode === 'doubles' ? 'btn-primary' : 'btn-secondary'}`}
    >
      <Users size={18} />
      ダブルス (2vs2)
    </button>
    <button
      onClick={() => setGameMode('singles')}
      className={`btn ${gameMode === 'singles' ? 'btn-primary' : 'btn-secondary'}`}
    >
      <User size={18} />
      シングルス (1vs1)
    </button>
  </div>
</div>
```

**バリデーション:**
- シングルス: 最低プレイヤー数 = コート数 × 2
- ダブルス: 最低プレイヤー数 = コート数 × 4

### 2. メイン画面（MainPage.tsx）

**ヘッダーにモードバッジ追加:**
```tsx
<div className="badge badge-primary">
  {session.config.gameMode === 'singles' ? 'シングルス' : 'ダブルス'}
</div>
```

### 3. コートカード（CourtCard.tsx）

**ダブルス表示（現状維持）:**
```
┌─────────────────────┐
│ Court 1   [試合中]  │
│ ┌──────┐  ┌──────┐  │
│ │ A ②  │  │ C ①  │  │
│ │ B ③  │  │ D ④  │  │
│ └──────┘  └──────┘  │
│   21  -  18         │
└─────────────────────┘
```

**シングルス表示（新規）:**
```
┌─────────────────────┐
│ Court 1   [試合中]  │
│                     │
│   A ②    vs   C ①   │
│                     │
│   21  -  18         │
└─────────────────────┘
```

**実装方針:**
- `court.gameMode` で表示分岐
- シングルス: 横並び1人ずつ表示
- ダブルス: 縦並び2人ずつ表示（既存維持）

### 4. スコア入力画面（ScoreInputPage.tsx）

**シングルス時の表示:**
```
┌─────────────────────┐
│ A          vs    C  │
│ [21] [19] [__]      │
└─────────────────────┘
```

**ダブルス時の表示（既存）:**
```
┌─────────────────────┐
│ A + B      vs  C + D│
│ [21] [19] [__]      │
└─────────────────────┘
```

---

## 🚀 実装計画

### Phase 1: 型定義とモード選択（2時間）
1. [ ] `src/types/session.ts` に `gameMode` 追加
2. [ ] `src/types/court.ts` の `teamA/teamB` を配列型に変更
3. [ ] `src/types/match.ts` に `gameMode` 追加
4. [ ] SessionCreate.tsx にモード選択UI追加
5. [ ] 型エラー修正（タプル → 配列対応）

### Phase 2: アルゴリズム実装（3時間）
6. [ ] `assignCourtsSingles()` 実装
7. [ ] 既存ロジックの統合（`assignCourts()` でモード分岐）
8. [ ] 待機時間・試合数バランスの適用
9. [ ] 予約機能のシングルス対応

### Phase 3: UI実装（2時間）
10. [ ] CourtCard.tsx でシングルス表示対応
11. [ ] MainPage.tsx にモードバッジ追加
12. [ ] ScoreInputPage.tsx でシングルス表示対応
13. [ ] プレイヤー選択でのバリデーション追加

### Phase 4: テスト・デバッグ（1時間）
14. [ ] `algorithm.test.ts` にシングルステスト追加
15. [ ] ビルドチェック (`npm run build`)
16. [ ] ローカル動作確認 (`npm run dev`)
17. [ ] Firebase同期テスト

---

## ✅ チェックリスト

### 実装前
- [ ] DESIGN.md を確認（デザインシステム準拠）
- [ ] 既存テストが通ることを確認 (`npm run test:run`)

### 実装中
- [ ] 型安全性を維持（any使用禁止）
- [ ] 既存ダブルス機能への影響ゼロ
- [ ] コメント記載（特にアルゴリズム部分）

### 実装後
- [ ] `npm run build` 成功
- [ ] `npm run lint` エラーなし
- [ ] `npm run test:run` 全テスト通過
- [ ] ローカルで両モード動作確認
- [ ] Firebase同期で互換性確認

---

## ❓ 未解決の論点

### 🔴 Critical（実装前に決定必須）

#### 1. シングルス配置アルゴリズムの詳細戦略

**現状:** 「レーティングが近い者同士をマッチング」と決定したが、具体的な実装方針が未定

**選択肢:**
```
待機プレイヤー: [A(1800), B(1700), C(1600), D(1500), E(1400), F(1300)]
コート2面の場合:

案1: 近い者同士ペアリング（連続ペア）
  C1: A(1800) vs B(1700)  差=100
  C2: C(1600) vs D(1500)  差=100
  待機: E, F
  → 差が均等、全試合が接戦

案2: 交互ペアリング
  C1: A(1800) vs C(1600)  差=200
  C2: B(1700) vs D(1500)  差=200
  待機: E, F
  → レーティング分布が均等

案3: 上位 vs 中位、中位 vs 下位
  C1: A(1800) vs D(1500)  差=300
  C2: B(1700) vs E(1400)  差=300
  待機: C, F
  → 上位に経験値、下位に挑戦機会
```

**判断基準:**
- [ ] 練習の目的は？（接戦重視 vs 挑戦機会 vs バランス）
- [ ] ダブルスとの整合性は？（ダブルスは同レベルでペア組成）
- [ ] ユーザーの期待値は？

**暫定案:** 案1（近い者同士）を採用 → フィードバック次第で変更可能

---

#### 2. 奇数人数時の扱い

**問題:** シングルスで奇数人数（例: 5人）の場合の配置戦略

**現状のダブルス:**
- 4の倍数でなくても配置可能
- 余ったプレイヤーは待機

**シングルスの場合:**
```
5人、2コート:
- C1: A vs B
- C2: C vs D
- 待機: E

次のローテーション:
- 誰を優先的にコートに入れるか？
- 待機時間の長い E を最優先？
```

**要検討:**
- [ ] 待機時間優先ロジックは既存と同じでOK？
- [ ] 奇数人数での公平性担保の方法は？

---

#### 3. 型変更の移行戦略

**問題:** `teamA: [string, string]` → `teamA: string[]` への移行

**影響範囲:**
- 18ファイルで直接参照
- algorithm.ts内で28箇所の `teamA`/`teamB` 参照

**選択肢:**

**案A: 一括変更（推奨）**
```typescript
// 全ての箇所を配列型に変更
teamA: string[]
// アクセス時は [0], [1] でインデックス指定
const player1 = court.teamA[0];
```
- メリット: 一度で終わる、型の一貫性
- デメリット: 大量の変更、テスト工数

**案B: 段階的移行（Union型）**
```typescript
teamA: [string, string] | string[]
// 型ガードで分岐
if (court.teamA.length === 1) { /* singles */ }
```
- メリット: 段階的に変更可能
- デメリット: 複雑性増加、一時的に型安全性低下

**案C: ラッパー関数で抽象化**
```typescript
function getTeamPlayers(team: [string, string] | string[], gameMode: GameMode): string[] {
  return Array.isArray(team) ? team : [team[0], team[1]];
}
```
- メリット: 既存コード変更最小
- デメリット: 抽象化レイヤー増加

**決定事項:**
- [ ] どの案を採用するか？
- [ ] テスト戦略は？（型変更後、全テスト書き直し？）

---

### 🟡 Important（実装中に決定可能）

#### 4. 予約機能の詳細仕様

**2人予約の扱い:**
```typescript
// ダブルス時: 同じチーム
reservation = { playerIds: ['A', 'B'] }
→ TeamA: [A, B], TeamB: [C, D]（C,Dは自動選出）

// シングルス時: 対戦カード固定？
reservation = { playerIds: ['A', 'B'] }
→ 案1: A vs B（固定対戦）
→ 案2: 無効（シングルスでは2人予約不可）
```

**判断:**
- [ ] シングルスで2人予約を「固定対戦」として扱うか？
- [ ] それとも2人予約はダブルス専用にするか？

**1人予約の扱い:**
```typescript
reservation = { playerIds: ['A'] }
→ Aを優先的にコート配置、相手は待機時間順で自動選出
```
- [ ] この動作でOK？

---

#### 5. UI配置の詳細デザイン

**CourtCard - シングルス表示のレイアウト:**

**案A: 横並び（シンプル）**
```
┌─────────────────────┐
│ A ②    vs    C ①    │
│      21 - 18        │
└─────────────────────┘
```

**案B: 左右分割（ダブルスと統一感）**
```
┌─────────────────────┐
│ ┌────┐      ┌────┐  │
│ │ A② │  vs  │ C① │  │
│ └────┘      └────┘  │
│      21 - 18        │
└─────────────────────┘
```

**案C: 上下配置（スマホ最適化）**
```
┌─────────────────────┐
│       A ②           │
│        vs           │
│       C ①           │
│      21 - 18        │
└─────────────────────┘
```

**判断基準:**
- [ ] DESIGN.mdとの整合性
- [ ] スマホでの見やすさ
- [ ] ダブルスとの統一感

---

#### 6. コート数の動的制約

**問題:** シングルスではプレイヤー数の半分しかコートを使えない

**例:**
```
プレイヤー8人の場合:
- ダブルス: 最大2コート（8÷4=2）
- シングルス: 最大4コート（8÷2=4）
```

**UI上の扱い:**
- [ ] コート数入力時に上限を動的に変更するか？
- [ ] 警告表示のみで制限しないか？
- [ ] モード変更時にコート数を自動調整するか？

**実装方針の候補:**
```typescript
// 案1: 上限を動的に計算
const maxCourts = gameMode === 'singles' 
  ? Math.floor(playerCount / 2)
  : Math.floor(playerCount / 4);

// 案2: 警告表示のみ（制限なし）
if (courtCount > maxCourts) {
  showWarning('プレイヤー数が不足しています');
}
```

---

### 🟢 Nice to Have（実装後に検討）

#### 7. パフォーマンス最適化

**懸念点:**
- シングルスはダブルスより計算量が少ない（2人 vs 4人）
- アルゴリズムの最適化余地はあるか？

**検討事項:**
- [ ] 現状のアルゴリズムで十分な速度か？
- [ ] 大人数（20人以上）での動作確認

---

#### 8. デプロイ戦略

**選択肢:**

**案A: 一括リリース**
- 全機能を実装してから一度にデプロイ
- メリット: 一貫性、テストしやすい
- デメリット: リリースまで時間がかかる

**案B: 段階的リリース**
- Phase 1: モード選択UIのみ（機能は未実装）
- Phase 2: シングルス配置アルゴリズム追加
- Phase 3: UI完成
- メリット: 早期フィードバック
- デメリット: 未完成機能の公開リスク

**案C: Feature Flag**
```typescript
const ENABLE_SINGLES = import.meta.env.VITE_ENABLE_SINGLES === 'true';
```
- 環境変数で機能ON/OFF切り替え
- メリット: 本番でテスト可能、段階的展開
- デメリット: 実装複雑化

---

#### 9. エラーハンドリング

**想定エラーケース:**
- [ ] シングルスでプレイヤー数 < コート数×2
- [ ] モード変更時に既存配置が無効化
- [ ] 予約とモードの不整合
- [ ] Firebase同期時のgameMode欠損

**対処方針:**
- [ ] エラーメッセージの文言
- [ ] リカバリー手順（自動修正 vs ユーザー操作要求）

---

#### 10. 国際化（i18n）対応

**現状:** ハードコードされた日本語
**将来:** 英語対応の可能性

**影響範囲:**
```typescript
// モード表示
'シングルス' → t('gameMode.singles')
'ダブルス' → t('gameMode.doubles')
```

- [ ] 今回実装時に国際化を考慮するか？
- [ ] それとも将来対応で十分か？

---

## 🔍 テスト観点

### Unit Tests
- [ ] シングルス配置アルゴリズムの正常動作
- [ ] 2人ずつのマッチングが正しいか
- [ ] 待機時間優先が機能するか
- [ ] 予約との統合が正しいか

### Integration Tests
- [ ] セッション作成→配置→試合終了の一連の流れ
- [ ] ダブルスとシングルスの切り替え
- [ ] Firebase同期でのデータ整合性

### Manual Tests
- [ ] UI: モード選択が直感的か
- [ ] UI: コートカード表示が適切か
- [ ] UX: プレイヤー数不足時の警告
- [ ] UX: モード切り替え時の挙動

---

## 📝 残課題・将来拡張

### Low Priority（今回は実装しない）
- [ ] コートごとに異なるモード（allowMixedMode）
- [ ] モード別の統計・履歴フィルタリング
- [ ] セッション中のモード変更機能
- [ ] 3人制、5人制への対応

### 技術的負債
- [ ] タプル型から配列型への完全移行
- [ ] 型ガード関数の統一的な実装
- [ ] テストコードのリファクタリング

---

**作成日:** 2026-01-30  
**最終更新:** 2026-03-10  
**ステータス:** 設計中 → 実装待ち
