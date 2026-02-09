# 性別を考慮した配置ロジック改善

**日付**: 2026-02-09
**対象**: `src/lib/algorithm.ts`, `src/types/player.ts`, UI各所

---

## 概要

プレイヤーに性別（男/女）を持たせ、コート配置アルゴリズムで**MIX戦（男女混合ペア）または同性対決を「やや優先」**する。

---

## 要件

### やや優先したい組み合わせ（4人選出時）

| 性別構成 | チーム編成 | 判定 |
|---------|----------|------|
| 4M | MM vs MM | 同性対決 (good) |
| 4F | FF vs FF | 同性対決 (good) |
| 2M+2F | MF vs MF | MIX戦 (good) |
| 3M+1F | MF vs MM or MM vs MF | 中途半端 (avoid) |
| 1M+3F | MF vs FF or FF vs MF | 中途半端 (avoid) |

### 設計方針

- 性別は任意フィールド（`gender?: 'M' | 'F'`）
- 4人全員に性別が設定されている場合のみ考慮
- 既存の優先度スコア（試合回数・滞在時間）を大きく崩さない
- 「やや優先」= 1試合差以内のプレイヤー間で入替が発生する程度

---

## アルゴリズム変更

### 1. selectBestFour: 性別ペナルティ

組み合わせスコアに性別ペナルティを加算:

```
comboScore = Σ playerScore(p) + genderPenalty(combo)
```

genderPenalty:
- 4人全員に性別が設定されていない → 0（影響なし）
- 4-0 or 2-2 → 0（good combo）
- 3-1 → 0.5 * oneGameDelta（small penalty）

oneGameDelta:
- 滞在時間OFF → 1.0
- 滞在時間ON → 1 / max(平均滞在分, 5)

ペナルティは0.5 * oneGameDelta = 0.5試合分。
→ 1試合差以内の候補者間で性別バランスが良い組に入替可能
→ 2試合以上差がある場合は優先度が勝つ

### 2. formTeams: MIXペアリング

4人の性別が2M+2Fの場合:

1. デフォルト（1位+4位 vs 2位+3位）がMFペアか確認
2. MFペアでなければ、1位+3位 vs 2位+4位に変更
   - 1+2 vs 3+4はスキルバランスが悪いため採用しない

```
例: [M1位, M2位, F3位, F4位]
デフォルト: M1+F4 vs M2+F3 → MF vs MF ✓

例: [M1位, F2位, M3位, F4位]
デフォルト: M1+F4 vs F2+M3 → MF vs FM ✓

例: [M1位, F2位, F3位, M4位]
デフォルト: M1+M4 vs F2+F3 → MM vs FF ✗
代替: M1+F3 vs F2+M4 → MF vs FM ✓
```

---

## UI変更

### プレイヤー入力（PlayerSelect）

テキスト入力で性別をサポート:
- `名前  M` or `名前  男` → 男性
- `名前  F` or `名前  女` → 女性
- `名前  1500  M` → レーティング + 性別

### プレイヤー表示

各プレイヤーの名前の横に性別バッジを表示:
- 男: `♂` (blue)
- 女: `♀` (pink)
- 未設定: 表示なし

---

## 影響範囲

| ファイル | 変更内容 |
|---------|---------|
| `src/types/player.ts` | gender フィールド追加 |
| `src/stores/playerStore.ts` | PlayerInput に gender 追加 |
| `src/lib/algorithm.ts` | selectBestFour, formTeams 変更 |
| `src/pages/PlayerSelect.tsx` | パーサー・UI 変更 |
| `src/pages/MainPage.tsx` | 性別表示・パーサー |
| `src/components/CourtCard.tsx` | 性別表示 |
| `src/lib/algorithm.test.ts` | テスト追加 |
