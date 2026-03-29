# 会計画面の追加バグ修正

## 日付: 2026-03-26

## 修正内容

### Bug 1: 自動同期useEffectのカウント比較もstale closure
- `exemptCount`, `maleCount`, `femaleCount` の比較が古いクロージャの値を使っていたため、ユーザーの手動変更が支払いデータ更新時に上書きされる可能性があった
- `useAccountingStore.getState().lastInput` から最新値を読み取って比較するよう修正

### Bug 2: isCreator() → isAdmin()
- 会計画面の管理者チェックが `isCreator()` のみだったため、追加管理者（session.admins）がアクセスできなかった
- `isAdmin()` に変更し、作成者 + 追加管理者の両方がアクセス可能に

### Bug 3: matchCountがGoogle Sheetsに送信されていなかった
- `sheetsApi.ts` のpayload構築で `matchCount` が除外されていた
- payloadに追加

## 修正ファイル
- `src/pages/AccountingPage.tsx`
- `src/lib/sheetsApi.ts`
