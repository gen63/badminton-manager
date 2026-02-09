# スプレッドシート読み込み時の性別が全て「女」になる不具合修正

**日付**: 2026-02-09
**対象**: `src/lib/sheetsMembers.ts`, `src/pages/SessionCreate.tsx`

> GAS スクリプトは別リポジトリで管理。本リポジトリでの GAS 修正はスコープ外。

---

## 不具合の症状

スプレッドシートから参加メンバーを読み込むと、性別が全員「女」として表示される。

---

## 原因分析

データフロー全体を追跡し、**フロントエンド側に2箇所の不具合**を特定。

### データフロー

```
[スプレッドシート] → [GAS doGet()] → [fetchMembersFromSheets()] → [membersToText()] → [textarea] → [parsePlayerInput()] → [addPlayers()]
                     ^^^^^^^^^^^                                     ^^^^^^^^^^^^^^^^                  ^^^^^^^^^^^^^^^^^^
                     別リポジトリ                                     Bug 1（主原因）                   Bug 2
```

---

### Bug 1（主原因）: `membersToText()` の性別判定が英字のみ（`src/lib/sheetsMembers.ts:126`）

```typescript
if (m.gender) parts.push(m.gender === 'M' ? '男' : '女');
```

GASから返される性別値が日本語（`"男"` / `"女"`）の場合:
- `"男" === 'M'` → **false** → `'女'` を出力
- `"女" === 'M'` → **false** → `'女'` を出力

**結果: 男性も全員「女」になる。**

`MemberFromSheet` の型定義は `gender?: 'M' | 'F'` だが、これはコンパイル時のみの制約。GASからのJSON応答は実行時には任意の文字列が入りうる。

---

### Bug 2: `SessionCreate.tsx` のローカル `parsePlayerInput` が性別未対応（`src/pages/SessionCreate.tsx:42-59`）

```typescript
// SessionCreate.tsx 内のローカル関数（性別を処理しない）
const parsePlayerInput = (line: string): { name: string; rating?: number } | null => {
  // ... name と rating のみ抽出、gender は無視
};
```

一方 `src/lib/utils.ts:69-99` にはM/F/男/女を正しく処理する `parsePlayerInput` が既に存在する。

`SessionCreate.tsx` が独自のローカル版を使っているため、textarea に「田中太郎  男  1500」と正しく表示されていても、セッション作成時に **性別情報が失われる**。

---

## 不具合の影響チェーン

```
GAS が性別を "男"/"女" で送信:
  → Bug 1: "男" === 'M' が false → textarea上で全員「女」表示

Bug 1 を修正して textarea に正しく表示:
  → Bug 2: ローカル parser が性別を無視 → Player に gender が設定されない
```

2つ全て修正しないと、スプレッドシートからの性別読み込みは正しく動作しない。

---

## 修正方針

### Fix 1: `membersToText()` で日本語性別にも対応（`src/lib/sheetsMembers.ts`）

GASから送られる性別値が `'M'`/`'F'` でも `'男'`/`'女'` でも正しく処理する:

```typescript
if (m.gender) {
  const g = String(m.gender);
  const isMale = g === 'M' || g === 'm' || g === '男';
  parts.push(isMale ? '男' : '女');
}
```

### Fix 2: `SessionCreate.tsx` のローカル parser を `utils.ts` の共通版に置換

```typescript
// Before: ローカルの parsePlayerInput（性別未対応）
const parsePlayerInput = (line: string): { name: string; rating?: number } | null => { ... };

// After: utils.ts の共通版を使う
import { parsePlayerInput } from '../lib/utils';
```

`handleCreate()` の filter 型注釈も更新:

```typescript
// Before
.filter((input): input is { name: string; rating?: number } => input !== null);

// After
.filter((input): input is { name: string; rating?: number; gender?: 'M' | 'F' } => input !== null);
```

---

## 変更ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `docs/Code.js` | **削除**（GASスクリプトは別リポジトリで管理） |
| `src/lib/sheetsMembers.ts` | `membersToText()` で日本語性別値にも対応 |
| `src/pages/SessionCreate.tsx` | ローカル `parsePlayerInput` を削除し、`utils.ts` の共通版を使用 |

---

## テスト計画

| # | シナリオ | 期待結果 |
|---|---------|----------|
| 1 | GASが性別を「男」「女」で返す場合 | textareaに正しく「男」「女」表示 |
| 2 | GASが性別を「M」「F」で返す場合 | 同上 |
| 3 | GASが性別を返さない場合 | 性別なし（名前とレーティングのみ表示） |
| 4 | 読み込み後「開始」でセッション作成 | Player の gender が正しく 'M'/'F' に設定される |
| 5 | 手動入力「田中太郎  男  1500」で開始 | 同上 |
| 6 | ビルド成功 | `npm run build` エラーなし |

---

## 実装順序

1. `docs/Code.js` — 削除（GASは別リポジトリ管理）
2. `src/lib/sheetsMembers.ts` — `membersToText()` の性別判定修正
3. `src/pages/SessionCreate.tsx` — ローカル parser 削除、`utils.ts` の共通版を import
4. `npm run build` — ビルド確認

---

## 設計判断

| 判断 | 理由 |
|------|------|
| GAS スクリプトを本リポジトリから削除 | 別リポジトリで管理するため |
| フロントエンド側で防御的に日本語チェック | GAS側の実装に依存しない。型安全が実行時に保証されないため |
| ローカル parser を削除して共通版を使う | 同じロジックの重複を排除。共通版は性別対応済み |
