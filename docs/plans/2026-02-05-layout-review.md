# レイアウト全体見直しプラン

**日付**: 2026-02-05
**目的**: DESIGN.md 基準に対する全ページのレイアウト一貫性レビュー

---

## 現状のサマリー

全5ページ + 共有コンポーネントを調査。
DESIGN.md の規定と実装の差異を洗い出した。

---

## 1. カード padding の不統一（重要度: 高）

DESIGN.md 規定: カード内 padding は `p-6`（24px）が標準。

| 箇所 | 現状 | 規定 | 差異 |
|------|------|------|------|
| CourtCard | `p-2`（8px） | `p-6`（24px） | **大幅に不足** |
| スコア未入力の試合カード | `p-4`（16px） | `p-6`（24px） | 不足 |
| 参加者一覧カード | `p-6`（24px） | `p-6`（24px） | OK |
| SessionCreate | `p-6` | `p-6` | OK |
| PlayerSelect | `p-6` | `p-6` | OK |
| HistoryPage | `p-6` | `p-6` | OK |
| SettingsPage | `p-6` | `p-6` | OK |

### 対応方針

- **CourtCard の `p-2`**: コートカードは横幅が `26%` と狭く、p-6 にすると中身が極端に窮屈になる。コンパクトカードとして `p-2` を維持するのが現実的。DESIGN.md に「コンパクトカード: `p-2`」の例外を追記する方向。
- **スコア未入力の試合カード**: `p-4` → `p-6` に統一可能。ただし内部リスト要素のためカード内セクションとして `p-4` で十分とも考えられる。他のカードと並んだ際の見た目で判断。

---

## 2. ボタンサイズの不統一（重要度: 高）

DESIGN.md 規定: タップ可能な要素は最低 44×44px。

| 箇所 | 現在のサイズ | 規定 | 問題 |
|------|-------------|------|------|
| CourtCard 配置/開始/終了ボタン | `py-1.5` + `min-height: 40px`（CSS） | 44px | **4px 不足** |
| CourtCard PlayerPill 閉じるボタン | `36×36px` | 44px | **8px 不足** |
| MainPage 参加者ピル 休憩/選択解除ボタン | `32×32px` | 44px | **12px 不足** |
| ScoreInputPage ナンバーグリッド | `48×48px` | 44px | OK |
| HistoryPage アクションボタン | `44×44px` | 44px | OK |
| ヘッダー icon-btn | `44×44px` | 44px | OK |

### 対応方針

- CourtCard ボタン: `min-h-[44px]` を明示。`py-1.5` → `py-2` に変更。
- PlayerPill 閉じるボタン: `36px` → `44px` に拡大。ピル自体の高さ調整が必要。
- 参加者ピルのアイコンボタン: `32px` → `min-w-[44px] min-h-[44px]` に。ただしピル内に収まるかレイアウト確認が必要。ピルの高さ（現在 `min-height: 2.25rem = 36px`）も `min-h-[44px]` に引き上げる必要あり。

**トレードオフ**: ピルを 44px に拡大すると 3カラムグリッドで各行が高くなり、一覧性が下がる。モバイルで 15人超の参加者がいると縦スクロールが増える。ピル自体のタップ領域は 44px に足りなくても「ピル全体がタップ可能」なので実質問題ない可能性がある。アイコンボタンのみ padding で拡張するのが現実解。

---

## 3. インラインスタイルの使用（重要度: 中）

Tailwind プロジェクトでインラインスタイルが 3箇所残っている。

| 箇所 | インラインスタイル | 代替案 |
|------|-------------------|--------|
| MainPage コートグリッド gap | `style={{ gap: '20px' }}` | `gap-5` |
| MainPage コートカード幅 | `style={{ width: '26%' }}` | Tailwind では直接対応なし。`w-[26%]` で可能 |
| MainPage 参加者グリッド maxWidth | `style={{ maxWidth: '616px' }}` | `max-w-[616px]` |
| CourtCard プレイヤー表示エリア minHeight | `style={{ minHeight: '188px' }}` | `min-h-[188px]` |

### 対応方針

すべて Tailwind の arbitrary value（`[]` 記法）に置き換え可能。機能的な問題はないが統一性のため修正推奨。

---

## 4. ページコンテナの max-width 差異（重要度: 低）

| ページ | max-width | 用途 |
|--------|-----------|------|
| SessionCreate | `max-w-md`（28rem） | フォーム |
| PlayerSelect | `max-w-2xl`（42rem） | 名簿入力 |
| MainPage | `max-w-6xl`（72rem） | コートグリッド表示 |
| ScoreInputPage | `max-w-2xl`（42rem） | スコア入力 |
| HistoryPage | `max-w-6xl`（72rem） | 履歴一覧 |
| SettingsPage | `max-w-2xl`（42rem） | 設定フォーム |

### 判定

意図的な使い分け。コート表示がある MainPage と履歴表示の HistoryPage は広い幅が必要で、フォーム系ページは狭い幅でOK。**問題なし。**

---

## 5. ヘッダーの一貫性（重要度: 低）

| ページ | ヘッダー構成 | padding |
|--------|-------------|---------|
| SessionCreate | ヘッダーなし | — |
| PlayerSelect | ヘッダーなし（アイコン + タイトル） | — |
| MainPage | `header-gradient p-3` | `p-3` |
| ScoreInputPage | `bg-white p-4 shadow-sm` | `p-4` |
| HistoryPage | `header-gradient p-3` | `p-3` |
| SettingsPage | `header-gradient p-3` | `p-3` |

### 問題点

- ScoreInputPage だけ `bg-white p-4 shadow-sm` でヘッダースタイルが異なる（`header-gradient` を使っていない）。
- ScoreInputPage は `p-4`、他は `p-3`。

### 対応方針

ScoreInputPage のヘッダーを `header-gradient p-3` に統一可能。ただし ScoreInputPage はモーダル的な画面（特定の試合にフォーカス）で意図的に異なる可能性あり。影響範囲が小さいため優先度低。

---

## 6. スコア未入力の試合セクション（重要度: 中）

現状（先ほど修正済み）:
- 入力ボタンをフルワイズ下配置に変更して配置ボタンと統一

残課題:
- カード padding が `p-4` で他の `p-6` と不統一。
- 「他N件」トグルボタンのタップ領域が `px-2 py-1` で小さい（高さ約 30px < 44px）。

---

## 7. 参加者リストのグリッドレイアウト（重要度: 中）

現状:
- `grid grid-cols-3 gap-2` + `maxWidth: 616px`（インラインスタイル）
- ピルの max-width: `max-w-[200px]`

### 問題点

- 画面幅が狭い端末（320px〜375px）で 3カラムだとピル内テキストが極端にトランケートされる。
- `max-w-[200px]` + `maxWidth: 616px` のダブル制約がやや冗長。
- レスポンシブ対応なし（PlayerSelect ページは `grid-cols-2 sm:grid-cols-3` で対応している）。

### 対応方針

`grid-cols-2 sm:grid-cols-3` にしてモバイル対応を検討。ただし MainPage は `max-w-6xl` で広い画面前提のため、実際のモバイル表示幅でのテストが必要。

---

## 8. ScoreInputPage の背景色（重要度: 低）

| ページ | 背景 |
|--------|------|
| 他全ページ | `bg-app`（ブルー→インディゴのグラデーション） |
| ScoreInputPage | `bg-gray-100`（単色グレー） |

### 判定

ScoreInputPage はスコア入力に集中させるための意図的な配色の可能性。統一すべきか要検討。

---

## 修正優先度まとめ

### P1（高優先度）
1. **CourtCard ボタンのタップ領域** → `min-h-[44px]` 確保
2. **参加者ピルのアイコンボタンのタップ領域** → padding 拡張

### P2（中優先度）
3. **インラインスタイルの Tailwind 化** → 4箇所
4. **スコア未入力の試合カード padding** → `p-4` のままか `p-6` に揃えるか決定
5. **参加者グリッドのレスポンシブ対応** → `grid-cols-2 sm:grid-cols-3`

### P3（低優先度）
6. **ScoreInputPage ヘッダースタイル統一** → `header-gradient` に変更
7. **ScoreInputPage 背景色** → `bg-app` に統一するか検討
8. **DESIGN.md に CourtCard 例外ルール追記**

---

## 影響範囲

| 修正対象ファイル | 影響 |
|----------------|------|
| `src/components/CourtCard.tsx` | ボタンサイズ変更 → ピル高さ変動の可能性 |
| `src/pages/MainPage.tsx` | インラインスタイル置換、ピルサイズ、カード padding |
| `src/pages/ScoreInputPage.tsx` | ヘッダー統一（P3） |
| `src/index.css` | `.player-pill` min-height 変更、`.btn-secondary` min-height 変更 |
| `DESIGN.md` | コンパクトカード例外ルール追記 |

---

## テスト観点

- CourtCard のレイアウト安定性（minHeight: 188px が変わらないか）
- 参加者ピルの高さ変更で 3カラムグリッドの見た目が崩れないか
- ボタンサイズ拡大でコートカード内がオーバーフローしないか
- iPhone SE（375px幅）での表示確認
