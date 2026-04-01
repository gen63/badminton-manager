# PWAタスクキル後に練習種別が「楽」→「複」にリセットされる問題の修正

## 問題

PWAでタスクをキルして再起動すると、練習種別が「楽」から「複」に変わる。

## 根本原因

タスクキル自体が原因ではなく、2つのバグの組み合わせが原因。

### 原因1: SessionCreateでの変更がsettingsStoreに反映されない

`src/pages/SessionCreate.tsx:80, 86`

`practiceType`だけがローカル`useState`で管理されており、ボタンを押してもsettingsStoreは更新されない。
`recordScores`や`prioritizeDiversity`はstoreのセッターを直接使っているのに、`practiceType`だけ例外。

```typescript
// 問題: ローカルstateのみ更新、settingsStoreは不変
const [practiceType, setPracticeType] = useState<'単' | '複' | '楽'>(defaultPracticeType);
onClick={() => setPracticeType(type)}  // settingsStoreは変わらない
```

### 原因2: AccountingPageがlastInputなしで'複'にフォールバック

`src/pages/AccountingPage.tsx:39, 89`

新規セッション作成時に`clearRecords()`でlastInputがnullになり、AccountingPageがデフォルト`'複'`を使う。
settingsStore.practiceTypeを見ていない。

### 発生フロー

```
前回セッション: AccountingPageで'楽'を使用（lastInput.practiceType='楽'保存）
  ↓
PWAタスクキル → 再起動
  ↓
新規セッション作成 → clearRecords() → lastInput=null
settingsStore.practiceType は '複'（SessionCreateで'楽'を選んでも保存されていない）
  ↓
AccountingPage: lastInputなし → デフォルト'複'
```

## 修正内容

### 修正1: SessionCreate.tsx

`practiceType`をローカルstateからsettingsStoreのセッターに変更（他の設定と統一）。

- `useSettingsStore()`から`setPracticeType`を追加取得
- `useState`の行を削除

### 修正2: AccountingPage.tsx

`lastInput`がない場合のフォールバックをハードコード`'複'`からsettingsStore.practiceTypeに変更。

## 修正ファイル

- `src/pages/SessionCreate.tsx`
- `src/pages/AccountingPage.tsx`
