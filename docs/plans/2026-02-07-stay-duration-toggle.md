# 滞在時間ベース優先度のオン・オフ切り替え

**日付**: 2026-02-07
**ステータス**: 計画中

---

## 背景・課題

現在、コート配置アルゴリズム (`src/lib/algorithm.ts`) では `calculatePriorityScore()` が**常に**滞在時間を考慮して優先度を計算している。

```
優先スコア = 試合回数 / max(滞在時間(分), 5)
```

この方式では、長く滞在しているのに試合数が少ない人が優先される。しかし、運用によっては**純粋に試合回数だけで優先度を決めたい**ケースもあるため、設定画面でオン・オフを切り替えられるようにしたい。

## 動作の違い

| モード | 優先スコア計算 | 例: 3試合/120分滞在 | 例: 3試合/30分滞在 |
|--------|---------------|---------------------|-------------------|
| **ON（滞在時間考慮）** | `gamesPlayed / stayMinutes` | 0.025（優先高） | 0.1（優先低） |
| **OFF（試合回数のみ）** | `gamesPlayed` | 3（同じ優先度） | 3（同じ優先度） |

- どちらのモードでも `gamesPlayed === 0` のプレイヤーは最優先（`-Infinity`）

## 変更対象ファイル

### 1. `src/stores/settingsStore.ts`
- `useStayDurationPriority: boolean` を追加（デフォルト: `true`＝現在の動作を維持）
- `setUseStayDurationPriority(value: boolean)` アクションを追加
- `badminton-settings` に永続化される（セッションリセットでも保持）

### 2. `src/lib/algorithm.ts`
- `assignCourts()` の `options` に `useStayDurationPriority?: boolean` を追加
- `calculatePriorityScore()` に `useStayDuration` パラメータを追加
- OFF時: `gamesPlayed` をそのまま返す（滞在時間を無視）
- ON時: 現在の `gamesPlayed / stayMinutes` を維持

### 3. `src/pages/SettingsPage.tsx`
- 「コート設定」セクション内にトグルUIを追加
- ラベル: 「滞在時間を考慮した配置優先度」
- 説明文: ON=長く滞在して試合数が少ない人を優先 / OFF=試合回数のみで優先度を決定
- トグルスイッチ（Tailwind CSSで実装）

### 4. `src/pages/MainPage.tsx`
- `handleAutoAssign()` 内で `settingsStore` から `useStayDurationPriority` を取得
- `assignCourts()` の `options` に渡す

## UI設計

設定画面の「コート設定」カード内に配置：

```
┌─────────────────────────────────────┐
│ 🏸 コート設定                        │
│                                     │
│ コート数    [1] [2] [3]             │
│ 目標点数    [15] [21]               │
│ 体育館      [ドロップダウン]         │
│                                     │
│ 滞在時間を考慮した配置優先度         │
│ ┌──────────────────────────── ───┐  │
│ │ ON: 滞在時間が長く試合数が    [●]│  │
│ │ 少ない人を優先                   │  │
│ └──────────────────────────────── ┘  │
└─────────────────────────────────────┘
```

## 実装手順

1. `settingsStore.ts` にフラグを追加
2. `algorithm.ts` にオプションを追加し、分岐ロジックを実装
3. `SettingsPage.tsx` にトグルUIを追加
4. `MainPage.tsx` で設定を読み取りアルゴリズムに渡す
5. ビルド確認 (`npm run build`)
