# スプレッドシート読み込み時の性別が全て「女」になる不具合修正

**日付**: 2026-02-09
**対象**: `docs/Code.js`, `src/lib/sheetsMembers.ts`, `src/pages/SessionCreate.tsx`

---

## 不具合の症状

スプレッドシートから参加メンバーを読み込むと、性別が全員「女」として表示される。

---

## 原因分析

データフロー全体を追跡し、**3箇所の不具合**を特定。

### データフロー

```
[スプレッドシート] → [GAS doGet()] → [fetchMembersFromSheets()] → [membersToText()] → [textarea] → [parsePlayerInput()] → [addPlayers()]
```

---

### Bug 1: GAS が性別列を読んでいない（`docs/Code.js:36-46`）

```javascript
// 現状: A列(名前)とB列(レーティング)のみ読み取り
var name = String(data[i][0]).trim();
var rating = parseInt(data[i][1], 10);
```

C列に性別があってもGASが読み飛ばしている。ただしユーザーが独自にGASを修正してC列の性別を返すようにしている場合でも、Bug 2 により全て「女」になる。

---

### Bug 2（主原因）: `membersToText()` の性別判定が英字のみ（`src/lib/sheetsMembers.ts:126`）

```typescript
if (m.gender) parts.push(m.gender === 'M' ? '男' : '女');
```

GASから返される性別値が日本語（`"男"` / `"女"`）の場合:
- `"男" === 'M'` → **false** → `'女'` を出力
- `"女" === 'M'` → **false** → `'女'` を出力

**結果: 男性も全員「女」になる。**

`MemberFromSheet` の型定義は `gender?: 'M' | 'F'` だが、これはコンパイル時のみの制約。GASからのJSON応答は実行時には任意の文字列が入りうる。

---

### Bug 3: `SessionCreate.tsx` のローカル `parsePlayerInput` が性別未対応（`src/pages/SessionCreate.tsx:42-59`）

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
Bug 1: GAS が性別を読まない
  → 性別なしで返却 → textareaに性別表示されない

Bug 1 が修正済み or ユーザーが独自GASで性別送信:
  → Bug 2: "男" === 'M' が false → 全員「女」表示

Bug 2 も修正して textarea に正しく表示:
  → Bug 3: ローカル parser が性別を無視 → Player に gender が設定されない
```

3つ全て修正しないと、スプレッドシートからの性別読み込みは正しく動作しない。

---

## 修正方針

### Fix 1: GAS `doGet()` でC列（性別）を読み取る（`docs/Code.js`）

```javascript
// 修正後
for (var i = 1; i < data.length; i++) {
  var name = String(data[i][0]).trim();
  if (!name) continue;

  var member = { name: name };

  var rating = parseInt(data[i][1], 10);
  if (!isNaN(rating)) {
    member.rating = rating;
  }

  // C列: 性別（任意）
  var gender = String(data[i][2] || '').trim().toUpperCase();
  if (gender === 'M' || gender === '男') {
    member.gender = 'M';
  } else if (gender === 'F' || gender === '女') {
    member.gender = 'F';
  }

  members.push(member);
}
```

- C列が空でもエラーにならない（`data[i][2] || ''` で安全）
- GAS側で正規化して `'M'` / `'F'` で返す → フロントエンドの型定義と一致

### Fix 2: `membersToText()` で日本語性別にも対応（`src/lib/sheetsMembers.ts`）

GAS側で正規化してもユーザーが独自GASを使う可能性があるため、フロントエンド側も防御的に実装:

```typescript
export function membersToText(members: MemberFromSheet[]): string {
  return members
    .map((m) => {
      const parts = [m.name];
      if (m.gender) {
        const g = String(m.gender).toUpperCase();
        parts.push(g === 'M' || g === '男' ? '男' : '女');
      }
      if (m.rating != null) parts.push(String(m.rating));
      return parts.join('  ');
    })
    .join('\n');
}
```

もしくはよりシンプルに、`'F'` と `'女'` を明示チェック:

```typescript
if (m.gender) {
  const g = String(m.gender);
  const isMale = g === 'M' || g === 'm' || g === '男';
  parts.push(isMale ? '男' : '女');
}
```

### Fix 3: `SessionCreate.tsx` のローカル parser を `utils.ts` の共通版に置換

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
| `docs/Code.js` | `doGet()` でC列（性別）を読み取り、'M'/'F' に正規化して返す |
| `src/lib/sheetsMembers.ts` | `membersToText()` で日本語性別値にも対応 |
| `src/pages/SessionCreate.tsx` | ローカル `parsePlayerInput` を削除し、`utils.ts` の共通版を使用 |

---

## スプレッドシートのシート構成（修正後）

| 列 | 内容 | 例 | 必須 |
|----|------|-----|------|
| A | 名前 | 田中太郎 | ○ |
| B | レーティング | 1500 | × |
| C | 性別 | 男 / 女 / M / F | × |

---

## テスト計画

| # | シナリオ | 期待結果 |
|---|---------|----------|
| 1 | C列に「男」「女」混在のシートから読み込み | textareaに正しく「男」「女」表示 |
| 2 | C列に「M」「F」混在のシートから読み込み | 同上 |
| 3 | C列が空のシートから読み込み | 性別なし（名前とレーティングのみ表示） |
| 4 | C列がないシートから読み込み | エラーなく動作、性別なし |
| 5 | 読み込み後「開始」でセッション作成 | Player の gender が正しく 'M'/'F' に設定される |
| 6 | 手動入力「田中太郎  男  1500」で開始 | 同上 |
| 7 | ビルド成功 | `npm run build` エラーなし |

---

## 実装順序

1. `docs/Code.js` — `doGet()` にC列読み取り追加
2. `src/lib/sheetsMembers.ts` — `membersToText()` の性別判定修正
3. `src/pages/SessionCreate.tsx` — ローカル parser 削除、`utils.ts` の共通版を import
4. `npm run build` — ビルド確認

---

## 設計判断

| 判断 | 理由 |
|------|------|
| GAS 側で 'M'/'F' に正規化 | フロントエンド型 `'M' \| 'F'` と一致。ネットワーク転送も軽量 |
| フロントエンド側も防御的に日本語チェック | ユーザーが独自GASを使う可能性、型安全が実行時に保証されないため |
| ローカル parser を削除して共通版を使う | 同じロジックの重複を排除。共通版は性別対応済み |
| C列は任意（後方互換） | 既存のA・B列のみのシートでもエラーにならない |

**注意:** `docs/Code.js` を変更した場合、ユーザーは GAS エディタで再デプロイが必要。
