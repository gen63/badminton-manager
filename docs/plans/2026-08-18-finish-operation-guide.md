# 終了操作の担当を継続表示する（配置予測「ほぼ確定」メンバーへの案内）

## 背景 / 課題

試合経過 4:30 で、配置予測の「ほぼ確定」メンバー（`NextMatchPredictionBar` の濃い青）へ
事前呼び出しのトースト・OS 通知・読み上げが出る
（`docs/plans/2026-08-13-next-match-call-notification.md`）。
しかしトーストは 8 秒で消えるため、**見逃すと誰が終了操作の担当なのか画面から分からない**。

これまでは「気づいた人が終了操作をする」運用だったが、今後は
**「濃い青＝次の試合に入るメンバーが終了操作をする」を継続的に明示する運用**にしたい。

## 要件

1. 消えないガイドを画面上部（`PresenceIndicator` の直下）に置く。
2. 2 段階で案内する。
   - どのコートが先に終わるか未定の間 → `終了操作担当` ＋ 担当の名前
   - どこかのコートが 4:30 を超えたら → `②付近待機 終了操作担当` ＋ 担当の名前
3. 表示対象は全員。**自分が担当のときだけ強調**する。
4. プレイ中コートがある間は常時表示する（段階1から出す）。
5. 既存の 4:30 トースト／OS 通知／読み上げ／管理者アナウンス（5:00）は**変更しない**。
   あちらは「気づかせる」、こちらは「いつでも確認できる」で補完関係にある。

## 表示領域の扱い

上部は既に情報が多いため、占有を最小にする。

- 段階1（4:30 未満）は `text-xs` / `px-3 py-1.5` の控えめな 1 行（約 28px）。
- 4:30 以降だけ色（オレンジ）と太字で強調する。コートカードの外枠が太くなる閾値
  （`COURT_EMPHASIS_THICK_MS`）と同じ 4:30 なので、上部とコートの見た目が連動する。
- 出す必要が無いときは**外側の余白ごと描画しない**。そのため `px-4 pt-2` は呼び出し側
  ではなくコンポーネント側に持たせている（`PresenceIndicator` の行のように空の余白が
  残るのを避ける）。

## 設計

### 判定は純粋関数（`src/lib/finishOperationGuide.ts`）

```ts
export type FinishGuidePhase = 'waiting' | 'imminent';

export function buildFinishOperationGuide(args: {
  courts: Court[];
  certainIds: Set<string>;
  now: number;
  showCourtNumber: boolean;
}): FinishOperationGuide | null;

export function buildFinishOperationGuideHeadline(guide: FinishOperationGuide): string;
export function getNextFinishGuideDelay(courts: Court[], now: number): number | null;
```

- 「経過最大のプレイ中コート」は `nextMatchCall.ts` の `maxPlayingCourt` /
  `maxPlayingElapsedMs` を再利用する。閾値も `MATCH_CALL_THRESHOLD_MS`（4:30）を共有し、
  呼び出し通知と必ず同じタイミングで切り替わるようにする。
- 非表示（`null`）の条件は 2 つ。
  1. プレイ中コート（`isPlaying && startedAt > 0`）が 1 面も無い
  2. `certainIds` のうちコートに乗っていない人が 0 人
     （促す相手がいない。`shouldAnnounceToAdmin` の `allOnCourt` 条件と同じ考え方）
- **`callBasisCourtId` は使わない**。あれは「次に配置される先」なので空きコートを
  優先するが、ここで欲しいのは「終了操作の対象＝もうすぐ終わるプレイ中コート」で別物。
  空きコートがある状況でも、指すのはプレイ中コートでなければならない。
- コート番号を出すかは呼び出し側が `courts.length > 1` で決める
  （`docs/plans/2026-08-14-single-court-message.md` と同じ方針）。
  1 面運用では `コート付近待機 終了操作担当` になる。

コート番号は**丸数字**（`②`）で出す。コートカードのヘッダーが番号を丸バッジで
出しているので丸数字だけでどのコートかは十分伝わり、`コート` の3文字を省ける。
Unicode に丸数字がある 1〜20 の範囲外は素の数字＋`コート` に戻す（`circledCourt`）。
「付近」は呼び出し通知（`Nコート付近で試合終了をお待ちください`）と同じ語彙に揃えた。

文言は依頼文（`終了操作をお願いします`）ではなく**役割ラベル**にする。常時表示なので
毎試合ずっと目に入り、依頼文は冗長。`終了操作担当` の方が「その人がやるもの」という
運用として伝わり、短いぶん 390px 幅でも見出しと名前チップが1行に収まる
（`imminent` の実測 68px → 44px）。名前は呼び出し通知（`〜さん`）と違いチップなので
敬称を付けない（`NextMatchPredictionBar` と同じ見せ方）。

### 表示（`src/components/FinishOperationGuide.tsx`）

`CourtCardFrame` と同じく**毎秒 tick せず**、`getNextFinishGuideDelay` が返す
4:30 までの残り時間で `setTimeout` を 1 本だけ張る（+50ms の余裕）。

| 段階 | スタイル |
|------|----------|
| `waiting` | `bg-muted/40 border-border text-muted-foreground` の 1 行 |
| `imminent` | `bg-orange-50 border-orange-300 text-orange-800` ＋ 見出し太字 |
| 自分が担当（`waiting`） | `ring-1 ring-indigo-300` ＋ 自分のチップを `bg-indigo-600 text-white` |
| 自分が担当（`imminent`） | `ring-1 ring-orange-400` ＋ 自分のチップを `bg-orange-600 text-white` |

自分強調の色は段階に合わせる。待機段階からオレンジにすると「もう終わりそう」に
見えてしまうため、待機段階は配置予測の「濃い青」（`NextMatchPredictionBar` の
indigo）に揃え、4:30 以降だけオレンジにする。

- 名前の表示順は `predictedPlayers`（入りやすい順）をそのまま使う。
- アイコンは `StopCircle`（`FinishGameButton` と同じ）で「終了操作」と結びつける。
- 読み上げはしない（既存の呼び出し通知が担当。二重に鳴らさない）。

### `PresenceIndicator` の縮小

ガイドと2行並ぶため、「操作中」表示は幅・高さとも最小限のチップにする。

- `px-4 py-2 text-sm shadow-md` → `px-2.5 py-0.5 text-[11px] shadow-sm`、アイコン `w-4` → `w-3`
- 文言から助詞・敬称を省く。`たろうさんが操作中` → `たろう 操作中`、
  2人は `たろう・はなこ 操作中`、3人以上は `たろう 他2名 操作中`。`NAME_MAX` は 12 → 8
- 操作中/閲覧中で分岐していた JSX を1つにまとめ、色だけ切り替える
- ガイドと同じく外側の余白（`px-4 pt-2`）をコンポーネント側に移し、非表示時に
  空の余白行を残さない（`MainPage` 側のラッパー div は削除）

実測（390px 幅、余白込み）: プレゼンス 48px → **28px**、
ガイドは `waiting` / `imminent` とも 44px（どちらも1行）。
両方出ていても上部の増分は 72px に収まる。

### 組み込み（`src/pages/MainPage.tsx`）

`PresenceIndicator` の行の直下に追加するのみ。`nextMatchPrediction` /
`predictedPlayers` / `myPlayerId` は既にある値をそのまま渡し、計算は増やさない。
既存の 4:30 通知 `useEffect` は無変更。

## テスト

- `src/lib/finishOperationGuide.test.ts`（19 件）— 非表示条件、4:30 境界、
  経過最大コートの選択、空きコートがあってもプレイ中コートを指すこと、
  1 面運用の文言、`getNextFinishGuideDelay` の残り時間。
- `src/components/FinishOperationGuide.test.tsx`（6 件）— フェイクタイマーで
  `waiting → imminent` の切り替わり、段階別の自分強調（indigo / orange）、
  全員コート上で消えること。

## スコープ外

- 終了操作そのものの権限制御（誰でも押せる点は変更しない。CLAUDE.md の信頼モデル通り
  これは UX 上の案内であって強制ではない）。
