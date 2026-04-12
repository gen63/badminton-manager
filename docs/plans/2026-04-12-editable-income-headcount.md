# 収入欄の人数を手入力可能にする + その他金額にマイナス入力対応

## Context

会計ページ（AccountingPage.tsx）の収入セクションにおいて、人数（男/女/免除）が静的テキスト表示のため直接入力できない。ユーザーは+/-ボタンでしか人数を変更できず、大きな変更時に不便。また「その他」金額欄で`inputMode="numeric"`を使用しているため、モバイルキーボードにマイナスキーが表示されず、負の金額を入力できない問題がある。

## 変更対象ファイル

- `src/pages/AccountingPage.tsx` のみ（store・型定義の変更不要）

## 変更1: 収入欄の人数を手入力可能にする

### 現状
収入セクション（line 917-1019）で人数は`<span>`タグで静的表示:
- Line 958: `<span className="text-sm font-semibold">{maleCount}</span>`
- Line 1002: `<span className="text-sm font-semibold">{femaleCount}</span>`
- Line 1014: `<span className="text-sm font-semibold">{exemptCount}</span>`

### 実装方針
各`<span>`を`<input type="number">`に置き換える。会費入力欄（maleFee/femaleFee, lines 935-945）と同様のパターンを使用。

**男の人数（line 958）:**
```tsx
// Before
<span className="text-sm font-semibold">{maleCount}</span>

// After
<input
  type="number"
  value={maleCount || ''}
  onChange={(e) => {
    const newValue = Math.max(0, parseInt(e.target.value) || 0);
    setMaleCount(newValue);
    saveAllInputs({ maleCount: newValue });
  }}
  className="w-10 text-sm font-semibold bg-card rounded px-1 py-0.5 text-center"
  inputMode="numeric"
  min="0"
  placeholder="0"
/>
```

**女の人数（line 1002）:** 同パターン（femaleCount / setFemaleCount）

**免除の人数（line 1014）:** 同パターン（exemptCount / setExemptCount）

### 設計判断
- `w-10`（40px）: 1-2桁の数値に十分。会費の`w-16`より狭くレイアウトに収まる
- `text-center`: `×`と合計額の間に位置するため中央揃えが自然
- `bg-card`: 会費入力欄と同じ白背景で「編集可能」を示唆
- `inputMode="numeric"`: 人数は非負整数のためモバイル数字キーボード
- `Math.max(0, ...)`: 負の値を防止（既存の-ボタンと同じ制約）
- 同じstate変数を使用するため参加人数セクションの+/-ボタンと自動同期
- `saveAllInputs`で永続化（既存パターン再利用）

## 変更2: その他金額に±トグルボタンを追加

### 現状
Line 1144-1157: `inputMode="numeric"` でモバイルキーボードにマイナスキーが出ない

### 実装方針
入力欄の横に±トグルボタンを追加し、タップで正負を切り替える。入力欄自体は`inputMode="numeric"`を維持して数字キーボードで快適入力。

```tsx
// Before
<div className="flex items-center gap-2">
  <span className="text-sm text-muted-foreground w-16">金額</span>
  <input
    type="number"
    value={otherAmount || ''}
    onChange={(e) => {
      const newValue = parseInt(e.target.value) || 0;
      setOtherAmount(newValue);
      saveAllInputs({ otherAmount: newValue });
    }}
    placeholder="0"
    className="flex-1 text-sm font-semibold bg-card rounded px-2 py-1 text-right"
    inputMode="numeric"
  />
</div>

// After
<div className="flex items-center gap-2">
  <span className="text-sm text-muted-foreground w-16">金額</span>
  <button
    onClick={() => {
      const newValue = -otherAmount;
      setOtherAmount(newValue);
      saveAllInputs({ otherAmount: newValue });
    }}
    className="w-8 h-8 rounded-full bg-card text-muted-foreground hover:bg-muted active:scale-95 flex items-center justify-center font-bold text-xs border border-border"
  >
    ±
  </button>
  <input
    type="number"
    value={Math.abs(otherAmount) || ''}
    onChange={(e) => {
      const absValue = Math.abs(parseInt(e.target.value) || 0);
      const newValue = otherAmount < 0 ? -absValue : absValue;
      setOtherAmount(newValue);
      saveAllInputs({ otherAmount: newValue });
    }}
    placeholder="0"
    className="flex-1 text-sm font-semibold bg-card rounded px-2 py-1 text-right"
    inputMode="numeric"
  />
</div>
```

### 設計判断
- ±ボタン方式: アプリ既存のボタンUIパターンと一貫性あり
- `inputMode="numeric"` 維持: モバイル数字キーボードで快適入力
- `Math.abs(otherAmount)` で表示: 入力欄には常に正の数値を表示
- `otherAmount < 0 ? -absValue : absValue` で符号保持: ±の状態を維持
- 計算ロジックは既にマイナス値対応済み（lines 424-447, 540-541）

## 検証方法

```bash
npm run build    # 型チェック + ビルド
npm run lint     # コードスタイル
npm run test:run # ユニットテスト
```

ブラウザ動作確認:
- 収入欄の男/女/免除の人数をタップして直接数値を入力できること
- 入力した値が参加人数セクションの合計・+/-ボタンにも反映されること
- 収入計算（単価×人数）が正しく更新されること
- その他金額の±ボタンで正負を切り替えられること
- マイナス値が合計に正しく反映され、コピーテキストにも反映されること
