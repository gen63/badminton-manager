# レイアウトシフト(CLS)見直し — 幅安定化

## Context

アプリ全体でレイアウトジャンプの抑止を考慮しているが、要素の幅が動的に変わる箇所でレイアウトが微妙にずれる問題がある。折りたたみ/展開系のシフトはユーザー操作起因であり許容。今回は **意図しない幅の変動** に絞って修正する。

---

## 修正対象

### 修正ファイル
- **`src/pages/MainPage.tsx`** — 2箇所

---

## 実装手順

### Step 1: 「連続」ボタンのONバッジ幅安定化（MainPage 行620）

**問題:** `{continuousMatchMode && <span>ON</span>}` でONバッジが出現/消滅し、ボタン全体の幅が変動する。

**修正:** ONバッジを常にレンダリングし、非表示時は `opacity-0 max-w-0 overflow-hidden px-0` で幅ゼロに折りたたむ。表示時は `opacity-100 max-w-[2rem]` で展開。`transition-all duration-150` で滑らかに切り替え。

```tsx
// Before
{continuousMatchMode && <span className="text-[10px] bg-green-200 px-1.5 py-0.5 rounded-full font-bold">ON</span>}

// After
<span className={`text-[10px] bg-green-200 py-0.5 rounded-full font-bold transition-all duration-150 ${
  continuousMatchMode
    ? 'opacity-100 max-w-[2rem] px-1.5'
    : 'opacity-0 max-w-0 overflow-hidden px-0'
}`}>ON</span>
```

### Step 2: コートヘッダー右側の幅安定化（MainPage 行759-775）

**問題:** タイマーバッジ / 削除ボタン / 空の3状態で右側の幅が変わり、コート番号やステータスラベルが水平にずれる。タイマーの数字も桁数変化で幅が変わる（"0:00" → "10:59"）。

**修正:**
1. 右側要素をラッパーで包み `min-w-[48px] flex justify-end` で最小幅を確保
2. タイマー表示に `tabular-nums` を追加し数字幅を一定に

```tsx
// Before
{court.isPlaying && court.startedAt ? (
  <div className="flex items-center gap-1 bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium">
    ...
  </div>
) : !hasPlayers && courts.length > 1 && (
  <button ...>...</button>
)}

// After
<div className="min-w-[48px] flex justify-end">
  {court.isPlaying && court.startedAt ? (
    <div className="flex items-center gap-1 bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium tabular-nums">
      ...
    </div>
  ) : !hasPlayers && courts.length > 1 && (
    <button ...>...</button>
  )}
</div>
```

---

## 調査済み・修正不要と判断した箇所

| 箇所 | 判断 | 理由 |
|------|------|------|
| MainPage タスクバー（行690-726） | 現状維持 | 完了後の即消えでOK。表示領域をフル活用する |
| MainPage 警告バー（行728-734） | 現状維持 | ユーザー操作起因 |
| MainPage スワップバナー（行979-994） | 現状維持 | ユーザー操作起因 |
| MainPage メンバー追加（行1011-1023） | 現状維持 | ユーザー操作起因 |
| CourtCard コート状態遷移 | 対策済み | `min-h-[220px]` で高さ固定済み |
| AccountingPage タブ切替 | 現状維持 | ユーザー操作起因のページ切替 |
| AccountingPage 免除行 | 現状維持 | カード内の1行で影響極小 |
| BottomNav バッジ | 対策済み | absolute配置でレイアウト影響なし |
| Toast通知 | 対策済み | fixed配置でレイアウト影響なし |
| PlayerEditModal エラー | 対策済み | `min-h-[20px]` でスペース予約済み |
| PlayerSelect 削除ボタン/✓マーク | 現状維持 | 要素極小（20px）で影響軽微 |
| PlayerSwapModal Step2 | 現状維持 | モーダル内スクロールコンテキスト |
| SessionJoinPage フォーム/エラー | 現状維持 | ユーザー操作起因 |
| ScoreInputPage 選択バナー | 現状維持 | ユーザー操作起因 |
| ReservationPage/Modal アコーディオン | 現状維持 | ユーザー操作起因 |

---

## 検証

1. `npm run build` — TypeScript + Viteビルド成功
2. `npm run lint` — ESLintパス
3. `npm run test:run` — 全テストパス
4. 手動確認:
   - 連続モードON/OFF → ボタン幅が安定していること
   - ゲーム開始/終了 → コートヘッダー右側が安定していること
   - タイマーが桁変わり（9:59→10:00等）で幅が変わらないこと
