# 経過時間によるコート枠の強調（4:30 で太枠 / 6:00 で破線点滅）

## 背景 / 課題

コートカードには経過時間タイマー（`CourtTimer`）が出ているが、10px の等幅数字なので
3コート並んだ画面をパッと見ても「どのコートがそろそろ終わりそうか」が分からない。
管理者は次の配置・呼び出しの判断のために「長引いているコート」を探しており、
数字を1面ずつ読む必要がある。

## 要件

1. 試合時間が **4分30秒** を超えたコートは、カードの外枠を太くして強調する。
2. **6分** を超えたコートは、外枠を**破線にして点滅**させ、さらに強調する。
3. 対象は試合中（`isPlaying` かつ `startedAt > 0`）のコートのみ。
   配置済み・未開始（「準備中」）のコートは対象外。

## 閾値の根拠

- **4:30** — 事前呼び出し通知の `MATCH_CALL_THRESHOLD_MS` と同値。
  「そろそろ次の人を呼ぶ」タイミングを枠でも示すことで、通知と見た目が一致する。
- **6:00** — 実測（2026-08-11）の試合時間は平均6.55分・中央値6.5分。
  6分超は「中央値付近まで来た＝長め」の目安になる。

## 設計

### 閾値判定は純粋関数（`src/lib/courtEmphasis.ts`）

```ts
export type CourtEmphasisLevel = 'none' | 'thick' | 'blink';
export function getCourtEmphasisLevel(startedAt: number, now: number): CourtEmphasisLevel;
export function getNextCourtEmphasisDelay(startedAt: number, now: number): number | null;
```

- `startedAt <= 0`（未開始・旧データ）や `startedAt` が未来（端末時刻ずれ）は `none`。
- `getNextCourtEmphasisDelay` は次に見た目が変わるまでの ms。`blink` 到達後は `null` で、
  以降タイマーを張らない。

### 枠は専用コンポーネント（`src/components/CourtCardFrame.tsx`）

`MainPage` のコートカードは `courts.map()` の中でインライン展開されているためフックを
呼べない。外枠の `div` だけを `CourtCardFrame` に切り出し、その中で状態を持つ。

- **毎秒 tick しない**: 経過時間の数字は `CourtTimer` が毎秒描画するが、枠は閾値を
  跨ぐ瞬間しか変わらない。`setInterval(1s)` ではなく次の閾値までの `setTimeout` を
  1本だけ張る（+50ms の余裕）。バックグラウンド復帰で遅れて発火しても `Date.now()`
  から再計算するのでズレは残らない。
- 枠クラス（`box-sizing: border-box` なのでカードの外寸は変わらない）:

  | レベル | クラス | 見た目 |
  |--------|--------|--------|
  | `none` | `border border-border` | 通常 |
  | `thick` | `border-2 border-orange-500` | 太いオレンジ枠（DESIGN.md: 警告） |
  | `blink` | `border-2 border-dashed border-destructive court-frame-blink` | 太い赤の破線枠＋点滅（DESIGN.md: 危険） |

### 破線点滅は Tailwind + CSS アニメーション（`src/index.css`）

`@keyframes court-frame-blink` で `border-color` を 1.2s ease-in-out で
`var(--color-destructive)` ⇄ 淡赤（#fecaca）に往復させる。`animation` は Tailwind の
`border-*` より優先されるため、点滅中の色指定は CSS 側で完結する。
破線そのものは Tailwind の `border-dashed` で付けるため、アニメーションは色の明滅だけを担う。
`prefers-reduced-motion: reduce` では `animation: none` とし、**赤い破線の太枠のまま据え置く**
（強調自体は失わない）。

## テスト

- `src/lib/courtEmphasis.test.ts` — 閾値ちょうど・未開始・未来時刻・次回遅延。
- `src/components/CourtCardFrame.test.tsx` — フェイクタイマーで
  `none → thick → blink` の遷移と、既に6分超で開始済みのコートの初回描画。

## 非対象

- 「準備中」（配置済み・未開始）コートの強調。自動開始まで3分なので枠を増やさない。
- 15分の自動終了（`MATCH_AUTO_END_MS`）との連動表示。
- 音・振動・通知（既存の呼び出し通知の担当）。
