# ボタンレイアウト統一プラン

**日付**: 2026-02-05
**目的**: アプリ全体でボタンの高さ・間隔・スタイルクラスの使い方を統一する

---

## 現状の問題点

### 1. ボタン高さ (min-height) の不統一

DESIGN.mdでは「タップ可能な要素は最低44×44px」と定義しているが、実際には3種類の高さが混在:

| 場所 | 現状の高さ | 基準(44px) |
|------|-----------|------------|
| CSSクラス (`btn-primary`等) | `min-height: 40px` | ❌ 4px不足 |
| CourtCard ボタン (`py-1.5`) | ~30px | ❌ 大幅に不足 |
| MainPage `入力`ボタン (`py-1.5 px-3`) | ~30px | ❌ 大幅に不足 |
| `icon-btn` | `44px` | ✅ |
| `select-button` | `48px` | ✅ |
| HistoryPage 編集/削除 | `min-w/h-[44px]` | ✅ |
| Player pill内ボタン | `32-36px` | ⚠️ コンテキスト次第 |

### 2. CSSクラス vs インラインスタイルの混在

| 場所 | 実装方法 |
|------|----------|
| CourtCard | `btn-primary`を使うが `py-1.5`でオーバーライド → CSSの`min-height`が無効化 |
| MainPage `入力`ボタン | 完全にインラインTailwind（CSSクラスなし） |
| HistoryPage 編集/削除 | 完全にインライン |
| SettingsPage | `btn-primary` を正しく使用 ✅ |

### 3. ボタン間の gap の不統一

| 場所 | gap |
|------|-----|
| CourtCard 開始/クリア | `gap`なし（`w-1/2`が隣接） |
| ScoreInputPage クリア/確定 | `gap-3` |
| ヘッダーボタン群 | `gap`なし |

### 4. border-radius の不統一

| 場所 | 値 |
|------|-----|
| CSSクラス (btn-*) | `0.375rem` (rounded-md) |
| DESIGN.md推奨 | `rounded-full` |
| `入力`ボタン | `rounded-lg` |
| `icon-btn` | `0.5rem` (rounded-lg) |
| スコア数字ボタン | `rounded-xl` |

---

## 修正方針

### 方針A: CSSクラスを基準に統一（推奨）

既存の `btn-primary`, `btn-secondary`, `btn-warning`, `btn-accent`, `icon-btn` を **正式なデザイントークン** として扱い、全ボタンをこれらに統一する。

### サイズバリエーション

コンテキストに応じた3サイズを定義:

| サイズ | min-height | 用途 |
|--------|-----------|------|
| **default** | `44px` | 標準ボタン（ページ内アクション、フォーム送信等） |
| **sm** | `36px` | カード内のコンパクトボタン（CourtCard、入力ボタン等） |
| **lg** | `48px` | 重要アクション（スコア入力数字、設定変更等） |

> **注意**: `sm`(36px) は44px基準を下回るが、カード内のスペース制約のため許容。
> ただし横幅は十分に確保し、タップ領域を補償する。

---

## 具体的な修正内容

### Step 1: CSSクラスの min-height を修正

**ファイル**: `src/index.css`

```css
/* 修正前: min-height: 40px → 修正後: 44px */
.btn-primary { min-height: 44px; }
.btn-secondary { min-height: 44px; }
.btn-accent { min-height: 44px; }
.btn-warning { min-height: 44px; }
```

小サイズ用のバリエーションクラスを追加:

```css
/* コンパクトボタン（カード内など狭いスペース用） */
.btn-sm {
  min-height: 36px;
  padding: 0.25rem 0.75rem;
  font-size: 0.75rem; /* text-xs */
}
```

### Step 2: CourtCard ボタンの統一

**ファイル**: `src/components/CourtCard.tsx`

現状: `btn-primary` + `py-1.5` でオーバーライドしている → CSSクラスの`min-height`が事実上無視

修正:
- `py-1.5` のオーバーライドを削除
- `btn-sm` クラスを追加してサイズを制御
- 開始/クリアボタンの間に `gap-1` を追加

```tsx
{/* 修正前 */}
<div className="flex pt-1">
  <button className="btn-primary w-1/2 ... text-xs py-1.5 ...">開始</button>
  <button className="btn-secondary w-1/2 ... text-xs py-1.5 ...">クリア</button>
</div>

{/* 修正後 */}
<div className="flex gap-1 pt-1">
  <button className="btn-primary btn-sm w-1/2 ...">開始</button>
  <button className="btn-secondary btn-sm w-1/2 ...">クリア</button>
</div>
```

同様に「配置」「終了」ボタンも `btn-sm` に統一。

### Step 3: MainPage `入力`ボタンの統一

**ファイル**: `src/pages/MainPage.tsx` (380行目付近)

現状: 完全にインラインスタイル（amber色テーマ）

修正: `btn-sm` を活用し、amber色はインラインで追加する、または `btn-inline` 新クラスを検討。

```tsx
{/* 修正前 */}
<button className="text-xs font-semibold text-amber-700 bg-white hover:bg-amber-50 active:bg-amber-100 active:scale-[0.98] py-1.5 px-3 rounded-lg border border-amber-200 flex-shrink-0 transition-all duration-150">
  入力
</button>

{/* 修正後: btn-sm ベース + amber色上書き */}
<button className="btn-sm text-amber-700 bg-white hover:bg-amber-50 active:bg-amber-100 border border-amber-200 rounded-lg flex-shrink-0">
  入力
</button>
```

### Step 4: HistoryPage 編集/削除ボタンの確認

**ファイル**: `src/pages/HistoryPage.tsx` (158-172行目)

現状: `min-w-[44px] min-h-[44px]` で44px確保済み → インラインだが基準は満たしている。
`icon-btn` クラスへの統一を検討するが、ホバー色がカスタム(indigo/red)なので、既存のまま維持が妥当。

### Step 5: Player pill 内ボタンの確認

**ファイル**: `src/pages/MainPage.tsx` (428-449行目付近)

現状: `min-w-[32px] min-h-[32px]` → pill内のコンパクトUI

修正: pill内のため32pxは許容。ただし`min-w/h-[36px]`に引き上げることでタップしやすさを改善。

---

## 影響範囲

| ファイル | 変更内容 | 影響度 |
|----------|----------|--------|
| `src/index.css` | min-height修正 + `btn-sm`追加 | 低（既存クラス利用箇所に影響） |
| `src/components/CourtCard.tsx` | ボタンクラス統一 | 中（見た目が若干変わる） |
| `src/pages/MainPage.tsx` | 入力ボタン・pillボタン修正 | 低 |
| `src/pages/HistoryPage.tsx` | 確認のみ（変更不要の可能性あり） | なし |

---

## 修正しないもの

| 項目 | 理由 |
|------|------|
| `border-radius` の統一 | DESIGN.mdで`rounded-full`推奨だが、CSSクラスは`rounded-md`で定着している。全面変更は影響が大きく、別タスクとする |
| `select-button` の高さ変更 | 48pxで基準超えており問題なし |
| ScoreInputPage の数字ボタン | 48px確保済み、専用UIで問題なし |

---

## テスト確認項目

- [ ] CourtCardの各ボタン（配置/開始/クリア/終了）が正しく表示される
- [ ] 開始・クリアボタンの間に適切なgapがある
- [ ] MainPageの「入力」ボタンが正しいサイズで表示される
- [ ] 既存のSettingsPage等のボタンが壊れていないこと
- [ ] `npm run build` が成功すること
