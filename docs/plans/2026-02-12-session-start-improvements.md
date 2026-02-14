# セッション開始画面の改善

**日付**: 2026-02-12
**対象ファイル**: `src/pages/SessionCreate.tsx`, `src/lib/sheetsMembers.ts`

---

## 要件

### 1. レート全員設定済みバッジ（赤丸R）
- スプレッドシートからデータ読み込み後、全員に rating >= 1 が設定されている場合
- 「Sheetsから読み込み」ボタンの右に赤丸の中に **R** と表示するバッジを追加

### 2. レート未設定時のデフォルト値
- スプレッドシートからの読み込み時、レート（rating）が設定されていないメンバーは **0** と表示
- 変更箇所: `membersToText()` 関数

### 3. プレースホルダーに性別表記の案内を追記
- テキストエリアのプレースホルダーに性別（男/女）入力のサンプルを追加
- 補足テキストにも性別入力方法を記載

---

## 実装計画

### Step 1: `membersToText()` の変更（要件2）

**ファイル**: `src/lib/sheetsMembers.ts` (line 131)

**変更内容**:
```typescript
// Before
if (m.rating != null) parts.push(String(m.rating));

// After
parts.push(String(m.rating ?? 0));
```

rating が null/undefined の場合に `0` を出力する。

---

### Step 2: 赤丸Rバッジ（要件1）

**ファイル**: `src/pages/SessionCreate.tsx`

**変更内容**:

1. `handleLoadFromSheets` で読み込み成功時に、全員のレートが1以上かどうかを state に保存

```typescript
const [allRated, setAllRated] = useState(false);
```

2. `handleLoadFromSheets` 成功時:
```typescript
if (result.success) {
  setPlayerNames(membersToText(result.members));
  const hasAllRatings = result.members.length > 0 &&
    result.members.every(m => m.rating != null && m.rating >= 1);
  setAllRated(hasAllRatings);
}
```

3. ボタンの右側にバッジを表示:
```tsx
{allRated && (
  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold ml-2">
    R
  </span>
)}
```

ボタンとバッジを横並びにするため、ボタンを含む div を `flex items-center gap-2` で囲む。

---

### Step 3: プレースホルダー更新（要件3）

**ファイル**: `src/pages/SessionCreate.tsx` (line 242, 247-248)

**変更内容**:
- placeholder を性別付きの例に変更:
```
星野真吾  男
山口裕史  男
佐野朋美  女
```
- 補足テキストに性別入力の案内を追加:
```
1行に1人ずつ入力（性別: 男/女、レートも入力可）
```

---

## 影響範囲

- `SessionCreate.tsx`: UI変更のみ、ロジック変更は state 追加のみ
- `sheetsMembers.ts`: `membersToText()` の出力変更 → テキストエリアに反映されるテキストが変わるだけ
- 既存の `parsePlayerInput()` は rating=0 も正常にパースできるため影響なし
