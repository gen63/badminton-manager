# データパース区切り文字の統一

## 日付: 2026-02-09

## 背景

プレイヤー入力のパース処理で、画面によって区切り文字の仕様が異なっている。

| 画面 | 区切り文字 | 性別パース |
|------|-----------|-----------|
| SessionCreate.tsx（ローカル関数） | タブ or スペース2+ | ❌ 非対応 |
| MainPage.tsx（インライン追加） | **スペース1+** (`/\s+/`) | ✅ 対応 |
| PlayerSelect.tsx | タブ or スペース2+（デフォルト） | ✅ 対応 |

## 問題点

1. MainPage のインライン追加だけ `/\s+/` で、スペース1つで分割される
2. SessionCreate にローカルの `parsePlayerInput` があり、性別パースに非対応
3. ユーザーがどの区切り文字を使えばよいか分かりにくい

## 方針

**スペース2つ以上（またはタブ）に統一する。**

理由：名前にスペースが含まれるケースへの安全策。デフォルト区切り `/\t|\s{2,}/` に寄せる。

## 変更内容

### 1. SessionCreate.tsx
- ローカルの `parsePlayerInput` を削除
- `src/lib/utils.ts` の共通 `parsePlayerInput` を import して使用
- `handleCreate` の filter 型を gender 含む型に更新

### 2. MainPage.tsx
- インライン追加の `parsePlayerInput(newPlayerName.trim(), /\s+/)` → `parsePlayerInput(newPlayerName.trim())` に変更
- デフォルト区切り（タブ or スペース2+）が適用される

### 3. UI ヒント
- SessionCreate.tsx: placeholder にフォーマット例を追加
- MainPage.tsx: インライン追加の placeholder にフォーマットヒントを追加

## 影響範囲

- PlayerSelect.tsx: 変更不要（すでにデフォルト区切りを使用）
- sheetsMembers.ts: 変更不要（出力はスペース2つ区切り）
- utils.ts: 変更不要（デフォルト区切りがそのまま正）
