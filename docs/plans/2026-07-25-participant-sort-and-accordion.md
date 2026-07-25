# 参加者管理ページのソート切替 + 全員完了時のアコーディオン自動展開

## Context

参加者管理ページ（`/players`）は現在 **試合数の多い順で固定ソート**
（`PlayerSelect.tsx` の `[...players].sort((a, b) => b.gamesPlayed - a.gamesPlayed)`）。

`docs/plans/2026-07-25-participant-last-seen.md` で「最終画面参照からの経過時間」を
表示できるようになったので、**「一番参照していない人が上」に並べ替えたい**という運用
ニーズが出た。放置している人を上に集めれば、声をかける対象が一目で分かる。

あわせて、全員がタスク（会費・名簿）を完了すると「未完了」リストが空になり、
折りたたまれた「完了済み（N人）」ヘッダーだけが残って画面がほぼ空に見える問題も直す。

## 仕様

### 1. ソート切替

- 選択肢は 2 つ:
  | モード | 並び順 | 既定 |
  |---|---|---|
  | `games` | 試合数が多い順 | ✓（現状の挙動） |
  | `lastSeen` | 参照していない人が上（最終参照が古い順） | |
- **表示権限**: ソート切替 UI は `isAdmin()` のときのみ表示する。`lastSeen` は管理者
  のみに見えるデータであり、非管理者に「見ていない順」を出しても根拠が画面に無く
  混乱するため。**非管理者は従来どおり試合数順で固定**（挙動変更なし）。
- **永続化しない**: 選択はコンポーネントの `useState`（既定 `games`）。CLAUDE.md の
  ローカルストレージ最小化方針（`settingsStore` の persist 対象は端末ローカル設定
  4 キーのみ）に従い、`settingsStore` へは追加しない。リロードで既定に戻る。
- **グルーピングは維持**: 「未完了」「完了済み（折りたたみ）」の 2 グループ構成は
  変えず、**各グループ内でソートする**。
- `lastSeen` モードの並び順（`未閲覧` が最上位 = 最も見ていない）:
  1. `lastSeen` エントリ無し（`未閲覧`）を先頭
  2. 次に `lastSeen` が古い順（昇順）
  3. 同値なら試合数の多い順 → 名前の昇順（`localeCompare('ja')`）で安定化

### 2. 全員タスク完了時のアコーディオン自動展開

- 「未完了」が 0 人になった時点で「完了済み」アコーディオンを**自動で開く**。
- **手動操作を尊重する**: 開いたあとユーザーが閉じられること。したがって
  「常に開く」派生値ではなく、`未完了 > 0 → 0` の遷移（およびマウント時に既に 0）で
  1 度だけ `paidCollapsed` を `false` にする `useEffect` にする。
  ```ts
  const allComplete = players.length > 0 && incompletePlayers.length === 0;
  useEffect(() => {
    if (allComplete) setPaidCollapsed(false);
  }, [allComplete]);
  ```
  `allComplete` が false に戻り再び true になったときのみ再発火するので、手動で
  閉じた状態が毎レンダーで上書きされることはない。
- 参加者 0 人（`players.length === 0`）は既存の空状態表示のままで、この処理は無効。

## 実装ステップ

### 1. ソートロジック（新規 `src/lib/playerSort.ts` + テスト）

純粋関数として切り出し、ユニットテスト可能にする。

```ts
export type PlayerSortMode = 'games' | 'lastSeen';

/** ソートに必要な最小フィールドだけを要求（Player 型全体に依存させない） */
interface SortablePlayer {
  name: string;
  gamesPlayed: number;
}

export function sortPlayers<T extends SortablePlayer>(
  players: T[],
  mode: PlayerSortMode,
  lastSeen: { [username: string]: number },
): T[];
```

- 破壊的変更を避け、必ず新配列を返す（`[...players].sort(...)`）。
- `games`: `b.gamesPlayed - a.gamesPlayed` → 同値は名前昇順で安定化
  （現状は同値時の順序が配列順依存なので、名前 tie-break で描画のちらつきも減る）。
- `lastSeen`: 上記「並び順」のとおり。`lastSeen[name]` が `undefined` / 数値でない
  場合は `-Infinity` 相当として扱い先頭へ寄せる。
- `src/lib/playerSort.test.ts`: `games` 同値の tie-break / `lastSeen` 昇順 /
  `未閲覧` が先頭 / 同一 `lastSeen` の tie-break / 入力配列を破壊しないこと / 空配列。

### 2. `src/pages/PlayerSelect.tsx`

- `const [sortMode, setSortMode] = useState<PlayerSortMode>('games');`
- `sortedPlayers` を `sortPlayers(players, isAdmin ? sortMode : 'games', lastSeen)` に差し替え
  （非管理者は常に `games`。UI を出さないだけでなくロジックでも固定する）。
- **グルーピング計算（`incompletePlayers` / `completePlayers`）を `renderPlayerList` から
  コンポーネント本体へ巻き上げる**（アコーディオン自動展開の `useEffect` から
  `incompletePlayers.length` を参照する必要があるため）。`renderPlayerList` は
  巻き上げた変数を使うだけにする。
- 上記「仕様 2」の `useEffect` を追加。
- ソート切替 UI: 「参加者一覧」見出しの直下、リストの上に配置。`isAdmin` のときのみ描画。
  既存の HistoryPage フィルタボタン（`src/pages/HistoryPage.tsx` L556 付近）の
  トーンに合わせた 2 分割セグメント:
  ```tsx
  <div className="flex gap-2 mb-3">
    {([['games', '試合数が多い順'], ['lastSeen', '見ていない順']] as const).map(([mode, label]) => (
      <button
        key={mode}
        onClick={() => setSortMode(mode)}
        aria-pressed={sortMode === mode}
        className={`flex-1 min-h-[44px] px-2 rounded-xl text-sm font-medium transition-colors active:scale-[0.98] ${
          sortMode === mode ? '' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
        }`}
        style={sortMode === mode ? { backgroundColor: '#e0e7ff', color: '#3730a3' } : undefined}
      >
        {label}
      </button>
    ))}
  </div>
  ```
  - タッチターゲット 44px は DESIGN.md 準拠。
  - 幅: カード内容幅 ≈287px（`max-w-md p-3` → 351 → `.card p-4` → 319 → gap-2 差引）を
    2 等分して 1 ボタン約 140px。`text-sm`(14px) で「試合数が多い順」7 文字 ≈98px なので収まる。

## 変更対象ファイル

| ファイル | 変更内容 |
|---|---|
| `src/lib/playerSort.ts` | **新規** `PlayerSortMode` / `sortPlayers` |
| `src/lib/playerSort.test.ts` | **新規** ユニットテスト |
| `src/pages/PlayerSelect.tsx` | ソート切替 UI + `sortMode` state + グルーピング巻き上げ + 自動展開 `useEffect` |

## 検証手順

1. `npm run build` / `npm run lint` / `npm run test:run` をすべて通す（CLAUDE.md 必須）。
2. 手動確認:
   - (a) 管理者で `/players` → 既定は「試合数が多い順」がアクティブ、並びは従来どおり
   - (b) 「見ていない順」を押す → `未閲覧` の人が最上位、以降 `N分前` が大きい順
   - (c) 未完了・完了済みの両グループでソートが効く
   - (d) 非管理者ではソート UI が出ず、試合数順で並ぶ
   - (e) 全員のタスクを完了させる → 「完了済み」が自動で開く
   - (f) (e) の状態で手動で閉じられる（閉じたまま維持され、再オープンされない）
   - (g) 参加者 0 人では従来の空状態表示のまま

## 非対象

- ソート選択の永続化（リロードで既定に戻る。ローカルストレージ最小化方針）
- 昇順/降順の反転トグル（2 モード固定で足りる）
- 非管理者への「見ていない順」提供（根拠データが非表示のため）
- 名前順・支払い状況順などの追加ソート軸
