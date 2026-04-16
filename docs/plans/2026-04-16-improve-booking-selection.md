# 予約機能改善：カテゴリ推測 + 最低2人制限 + 同性優先補充

## Context

バドミントン練習管理アプリの予約機能を改善する。現在、予約は1〜4人で作成可能だが、
1人予約は実用的でなく、また選択メンバーの性別構成からダブルスの種別（男子ダブルス/女子ダブルス/ミックス）を
推測できるにもかかわらず、それが活用されていない。

**変更点:**
1. 最低選択人数を1→2に変更
2. 性別構成からダブルスカテゴリを自動推測してUIに表示（2〜4人すべて）
3. コート配置時、残り枠の補充で同性プレイヤーを優先する（不足時は異性で補充、3-1も許容）

## 設計方針

**カテゴリはReservation型に保存せず、プレイヤーの性別からオンデマンドで計算する。**
- カテゴリはplayerIdsと性別から完全に導出可能なため、保存は不要
- Reservation型・ストア・Firebase同期・localStorage移行の変更が不要

## 変更ファイル一覧

### 1. `src/lib/reservationUtils.ts` — 推測関数の追加

既存の `isPlayerReady`, `getReservationStatus` と同じファイルに追加:

```typescript
export type DoublesCategory = '男子ダブルス' | '女子ダブルス' | 'ミックスダブルス' | null;

export function inferDoublesCategory(
  playerIds: string[],
  players: Player[],
): DoublesCategory {
  if (playerIds.length < 2) return null;
  const genders = playerIds
    .map(id => players.find(p => p.id === id)?.gender)
    .filter((g): g is 'M' | 'F' => g === 'M' || g === 'F');
  if (genders.length !== playerIds.length) return null; // 性別未設定あり→推測不可
  const maleCount = genders.filter(g => g === 'M').length;
  if (maleCount === 0) return '女子ダブルス';
  if (maleCount === playerIds.length) return '男子ダブルス';
  return 'ミックスダブルス';
}

export function getCategoryShortLabel(category: DoublesCategory): string | null {
  if (!category) return null;
  switch (category) {
    case '男子ダブルス': return 'ダンダブ';
    case '女子ダブルス': return 'ジョダブ';
    case 'ミックスダブルス': return 'ミックス';
  }
}
```

### 2. `src/components/ReservationAddModal.tsx` — 最低2人 + カテゴリ表示

- **line 32**: `selectedIds.size >= 1` → `selectedIds.size >= 2`
- **line 123**: `disabled={selectedIds.size === 0}` → `disabled={selectedIds.size < 2}`
- **ヘッダー subtitle**: カテゴリ推測ラベルを表示（selectedIds >= 2の場合）
  - 色: 男子→`bg-blue-100 text-blue-700`、女子→`bg-pink-100 text-pink-700`、ミックス→`bg-purple-100 text-purple-700`
  - nullの場合（性別未設定あり）は表示しない

### 3. `src/pages/ReservationPage.tsx` — 予約カードにカテゴリバッジ

- 各pending予約カード（line 80-146）で `inferDoublesCategory` 呼び出し
- `#{orderNumber}` の横にカテゴリバッジを表示
- 色は ReservationAddModal と統一

### 4. `src/components/ReservationModal.tsx` — 同様にカテゴリバッジ

- ReservationPageと同じロジック・スタイルでカテゴリバッジを追加（line 82付近）

### 5. `src/lib/algorithm.ts` — 同性優先補充ロジック

ダブルスモードの予約配置処理（line 896〜994）に同性優先ロジックを追加。

#### ヘルパー関数: `sortByGenderPreference`

```typescript
function sortByGenderPreference(
  reservedPlayerIds: string[],
  candidates: Player[],  // すでにpriority順にソート済み
  allPlayers: Player[],
): Player[] {
  // 予約メンバーの性別構成を分析
  const reservedGenders = reservedPlayerIds
    .map(id => allPlayers.find(p => p.id === id)?.gender)
    .filter((g): g is 'M' | 'F' => g === 'M' || g === 'F');
  
  if (reservedGenders.length !== reservedPlayerIds.length) return candidates; // 性別不明→優先なし
  
  const maleCount = reservedGenders.filter(g => g === 'M').length;
  const femaleCount = reservedGenders.filter(g => g === 'F').length;
  
  if (maleCount > 0 && femaleCount > 0) {
    // ミックス: 性別バランスを目指す（不足性別を優先）
    // 例: 1M+1F → 残り2枠にM1+F1を優先
    // 例: 2M+1F → 残り1枠にF優先
    const targetGender = maleCount > femaleCount ? 'F' : maleCount < femaleCount ? 'M' : null;
    if (targetGender === null) {
      // 同数（例: 1M+1F）→ 残り2枠にM1+F1を配置するため特殊処理
      // priority順でM1人とF1人を選出
      const bestM = candidates.find(p => p.gender === 'M');
      const bestF = candidates.find(p => p.gender === 'F');
      if (bestM && bestF) {
        const others = candidates.filter(p => p.id !== bestM.id && p.id !== bestF.id);
        return [bestM, bestF, ...others];
      }
    } else {
      // 不足性別を先頭に
      const preferred = candidates.filter(p => p.gender === targetGender);
      const others = candidates.filter(p => p.gender !== targetGender);
      return [...preferred, ...others];
    }
    return candidates;
  }
  
  // 同性のみ（男子 or 女子ダブルス）: 同性を優先
  const targetGender = maleCount > 0 ? 'M' : 'F';
  const sameGender = candidates.filter(p => p.gender === targetGender);
  const otherGender = candidates.filter(p => p.gender !== targetGender);
  return [...sameGender, ...otherGender];
}
```

#### 適用箇所

**2人予約（line 944-964）**: `nonReserved.sort(...)` の後に `sortByGenderPreference` を適用:
```typescript
nonReserved.sort((a, b) => calculatePriorityScore(a, ...) - calculatePriorityScore(b, ...));
const sorted = sortByGenderPreference(rsvPlayerIds, nonReserved, activePlayers);
// sorted[0], sorted[1] を使用
```

**3人予約（line 923-943）**: 同様に `nonReserved.sort(...)` の後に適用:
```typescript
nonReserved.sort((a, b) => calculatePriorityScore(a, ...) - calculatePriorityScore(b, ...));
const sorted = sortByGenderPreference(rsvPlayerIds, nonReserved, activePlayers);
const fourth = sorted[0];
```

**1人予約（line 965-989）**: 新規作成不可だが、既存データの後方互換のためコードは残す。変更なし。

#### 同性不足時の挙動

- 警告・ブロックなし
- ソフトフィルター方式：同性候補をpriority順で先頭に、不足分は異性で埋める
- 3-1構成（例: 3F+1M）も許容

### 6. テスト — `src/lib/reservationUtils.test.ts` (新規)

`inferDoublesCategory` のユニットテスト:
- 2M → 男子ダブルス
- 2F → 女子ダブルス
- 1M+1F → ミックスダブルス
- 3M → 男子ダブルス、3F → 女子ダブルス、2M+1F → ミックス
- 4M → 男子ダブルス、4F → 女子ダブルス、2M+2F → ミックス、3M+1F → ミックス
- 性別未設定ありのケース → null
- 1人 → null
- `getCategoryShortLabel` のテスト

## 注意点

- **シングルスモード**: 現在 ReservationAddModal は gameMode を知らない。カテゴリバッジは「ダブルス」前提のため、シングルスモード時には厳密には不適切だが、実用上の問題は小さい（シングルスモードの利用頻度が低い）。将来必要なら gameMode を渡してバッジ表示を制御可能。
- **Firebase同期**: Reservation型を変更しないため、同期への影響なし。
- **既存1人予約**: localStorageに残っている場合は表示・消化可能。新規作成のみブロック。

## 検証方法

1. `npm run build` — 型チェック通過
2. `npm run lint` — lintエラーなし
3. `npm run test:run` — テスト通過（新規テスト含む）
4. 手動確認:
   - 予約追加画面で1人選択時にOKボタンが無効であること
   - 2人選択時にカテゴリが正しく推測表示されること
   - 3人・4人でも推測が正しいこと
   - 性別未設定プレイヤー含む場合にバッジが出ないこと
   - 予約一覧（ReservationPage, ReservationModal）でカテゴリバッジが表示されること
