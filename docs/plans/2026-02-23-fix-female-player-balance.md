# 女性プレイヤーのバランス改善

**日付**: 2026-02-23
**対象**: `src/lib/algorithm.ts`

---

## 問題

10人中3人が女性の場合、ゲームを続けると女性1人だけがコートに入る（3M+1F）状況が頻発する。

### 根本原因

1. `getGenderPenalty` の3:1ペナルティが弱すぎる（0.5 × oneGameDelta）
2. `assign2CourtsHolistic` に性別考慮がなく、女性がバラバラのコートに分散される
3. 女性が異なるタイミングで試合終了 → 待機プールに1人だけになるサイクル

---

## 解決方針

**女性をなるべく同じコートにまとめる（2M+2F）** → 同時に試合終了 → 同時に待機復帰

---

## 変更内容

### 1. `getGenderPenalty`: 3:1ペナルティ強化

```
Before: oneGameDelta * 0.5  (0.5試合分)
After:  oneGameDelta * 3.0  (3試合分)
```

- 4Mの組み合わせ（ペナルティ0）が3M+1Fより強く優先される
- 2M+2Fも0なのでMIXも同等に優先

### 2. `assign2CourtsHolistic`: 性別考慮の追加

8人選出後の処理:

1. 選出された8人の中の女性数をカウント
2. 女性が奇数人（1人 or 3人）の場合:
   - 優先度が最も低い女性を除外
   - 代わりに次順位の男性を投入
   - ただし除外対象の女性が gamesPlayed === 0（初回保証）の場合は除外しない
3. 残った女性を同じコートにまとめてMIX配置

### 3. フェアネス保証

- `selectBestFour` 側: gamesPlayed === 0 の女性は -1e9 スコアでペナルティを上回るため、初回は必ず投入
- `assign2CourtsHolistic` 側: gamesPlayed === 0 の女性は除外しない
- ペナルティ3.0xにより、3試合分以上待った女性は優先度でペナルティを自然に上回り投入される

---

## 影響範囲

| ファイル | 変更内容 |
|---------|---------|
| `src/lib/algorithm.ts` | `getGenderPenalty`, `assign2CourtsHolistic` |

---

## 期待される動作

```
10人: F1, F2, F3, M1-M7 / 2コート

Round 1: Court 1 = F1,F2,M1,M2 (MIX) / Court 2 = M3,M4,M5,M6 (4M)
  → F3は待機（1人だけなので4Mを優先）

Court 1終了 → 待機: F1,F2,F3,M1,M2,M7
  → Court 1 = F1,F3,M1,M7 (MIX) ← 女性2人まとめ

Court 2終了 → 待機: F2,M2,M3,M4,M5,M6
  → Court 2 = M2,M3,M4,M5 (4M) ← F2は待機

Court 1終了 → 待機: F1,F2,F3,M1,M6,M7
  → Court 1 = F2,F3,M6,M1 (MIX) ← 女性2人まとめ
```

→ 女性は常にMIXで参加、3:1は回避される
