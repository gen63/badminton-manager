# コート適性ペナルティの再設計

**日付**: 2026-02-08
**ステータス**: 計画中

---

## 現状

前回のコミットでコート適性ペナルティを完全削除した。しかし、ペナルティがないと **prob=0以外の候補者は全員フラットに扱われ、コート適性が「誰がどのコートに入るか」に全く影響しない**。

### 現在のコード（ペナルティなし）

```
assignCourts
  → courtCandidates: prob=0 のみ除外（ハード制約）
  → 優先度ソート: calculatePriorityScore のみ（待機時間）
  → selectTopFour: 全C(N,4)探索、playerScore = calculatePriorityScore のみ
```

### 問題

3コートの場合:
- C2に upper(prob=0.50) と middle(prob=0.50) がいても、待機時間だけで決まる
- コート適性の「50% vs 25%」の差が全く効かない
- 同じ待機時間の候補者間で、コートに合った人を優先する仕組みがない

---

## 旧方式のペナルティ（削除前）

```typescript
penalty = Math.random() × (1 - courtProb) × COURT_SWAP_THRESHOLD_MINUTES
// COURT_SWAP_THRESHOLD_MINUTES = 5
```

### 各グループのペナルティ範囲（3コート）

| グループ | C1(prob) | penalty範囲 | C2(prob) | penalty範囲 | C3(prob) | penalty範囲 |
|---------|---------|------------|---------|------------|---------|------------|
| upper   | 0.00(除外) | - | 0.50 | 0〜2.5分 | 0.50 | 0〜2.5分 |
| middle  | 0.25 | 0〜3.75分 | 0.50 | 0〜2.5分 | 0.25 | 0〜3.75分 |
| lower   | 0.50 | 0〜2.5分 | 0.00(除外) | - | 0.50 | 0〜2.5分 |

### 前回の議論で指摘された問題

待機時間差が1〜2分（典型的なシナリオ）に対し、ペナルティ最大が3.75分 → **ペナルティが支配的で、待機時間の順序がほぼ意味をなさない**。

---

## 再設計の選択肢

### 案A: ペナルティ閾値を縮小

```typescript
const COURT_SWAP_THRESHOLD_MINUTES = 2;  // 5→2に縮小
penalty = Math.random() × (1 - courtProb) × COURT_SWAP_THRESHOLD_MINUTES;
```

| グループ | C1 penalty範囲 | C2 penalty範囲 |
|---------|---------------|---------------|
| middle(0.25) | 0〜1.5分 | 0〜1.0分 |
| lower/upper(0.50) | 0〜1.0分 | 0〜1.0分 |

- 待機時間差2分以上なら待機時間が必ず勝つ
- 待機時間差1分以内ならコート適性が影響する
- **シンプル、旧方式の閾値調整のみ**

### 案B: ペナルティ閾値を設定可能にする

```typescript
// settingsStoreで閾値を公開
courtSwapThreshold: number  // デフォルト2分、0〜5分で調整
```

- 運用者が調整可能
- 設定UIが増える（シンプル化の方針に反する）

### 案C: 待機時間差に比例したペナルティ

```typescript
// 最長待機者との差に対する割合でペナルティ
const maxWait = Math.max(...candidates.map(calculatePriorityScore));
const relativeWeight = 0.3;  // 待機時間差の30%までペナルティで逆転可能
penalty = Math.random() × (1 - courtProb) × |maxWait| × relativeWeight;
```

- 待機時間が短い場面でも長い場面でも自然にスケール
- 複雑さが増す

---

## 推奨: 案A（閾値縮小）

理由:
1. **シンプル** — 旧方式の定数変更だけで実現
2. **バランス** — 2分閾値なら「同時期に戻ってきた人同士ではコート適性が効く、明らかに長く待った人は優先される」
3. **全組み合わせ探索との相性** — C(N,4)探索でペナルティ込みのスコアを比較するので、最適な組み合わせが選ばれる

### 実装範囲

`selectTopFour` に `courtPenalties` パラメータを復活:

```typescript
function selectTopFour(
  candidates: Player[],
  matchHistory: Match[],
  groups3: Map<RatingGroup, Set<string>> | null,
  totalCourtCount: number,
  courtPenalties: Map<string, number>,  // 復活
): Player[] {
  // ...
  const playerScore = (p: Player): number => {
    const base = calculatePriorityScore(p);
    if (base === -Infinity) return -1e9;
    return base + (courtPenalties.get(p.id) ?? 0);
  };
  // ...
}
```

`assignCourts` にコートペナルティ計算を復活（閾値2分に変更）:

```typescript
const COURT_SWAP_THRESHOLD_MINUTES = 2;
const courtPenalties = new Map<string, number>();
for (const p of courtCandidates) {
  if (p.gamesPlayed === 0) continue;
  let prob = 0.5;
  if (totalCourtCount >= 3 && groups3) {
    const group = getPlayerGroup(p.id, groups3) as RatingGroup;
    prob = COURT_PROBABILITIES_3[group]?.[courtId - 1] ?? 0.5;
  }
  courtPenalties.set(p.id, Math.random() * (1 - prob) * COURT_SWAP_THRESHOLD_MINUTES);
}
```

### 変更対象

1. `src/lib/algorithm.ts` — selectTopFour にペナルティ復活、assignCourts にペナルティ計算復活（閾値2分）
2. `docs/plans/` — 本プラン

### 維持するもの（変更なし）

- `calculatePriorityScore` は待機時間ベース（簡素化済み）
- `eligible` → `courtCandidates` のリネーム
- 全組み合わせ探索（C(N,4)）
- `useStayDurationPriority` の削除
- `practiceStartTime` の削除

---

## 2分閾値での具体例

15人待機、C2に配置する場合:

| プレイヤー | グループ | 待機時間 | priorityScore | penalty(中央値) | 合計(中央値) |
|-----------|---------|---------|--------------|----------------|-------------|
| A | middle | 8分 | -8.0 | +0.5 | -7.5 |
| B | upper | 7分 | -7.0 | +0.5 | -6.5 |
| C | middle | 6分 | -6.0 | +0.5 | -5.5 |
| D | lower | 5.5分 | -5.5 | (除外) | - |
| E | middle | 5分 | -5.0 | +0.5 | -4.5 |
| F | upper | 4.5分 | -4.5 | +0.5 | -4.0 |

→ A,B,C,Eが選出（待機時間上位4人がそのまま選ばれる。ペナルティは最大1.5分なので8分vs5分の3分差は逆転しない）

もしAとCの待機時間が同じ6分で、Fが6.5分待ちだった場合:
- A(middle, C2 prob=0.50): penalty 0〜1.0
- C(middle, C2 prob=0.50): penalty 0〜1.0
- F(upper, C2 prob=0.50): penalty 0〜1.0
→ 同確率なので待機時間差で決まる → Fが優先

もしF がupperでC1配置(prob=0.50→C2は候補外... いや3コートならC2 prob=0.50なのでOK)。待機時間が近い人同士ではペナルティの乱数が結果を左右し、適性の高い人が若干有利になる。
