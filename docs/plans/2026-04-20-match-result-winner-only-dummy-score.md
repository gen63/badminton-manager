# 試合終了直後のインターフェースを勝敗のみに（100-99 ダミースコア版）

**日付**: 2026-04-20
**ステータス**: 確定
**ブランチ**: `claude/add-match-result-interface-ALlKC`
**先行プラン**: `docs/plans/2026-04-19-match-result-winner-only.md`（0-0 採用）→ 本プランで改訂

---

## Context

試合終了時に `recordScores=ON` だと `ScoreInputModal` が開き、両チームの数字入力を 2 回要求される。片付け・次試合準備で忙しい直後には重い。**勝敗のみの軽量入力**に差し替えたい。

先行プラン（04-19）では `winner` のみ記録して `scoreA/scoreB=0` とする設計だったが、ユーザー要件を再確認した結果、**勝者チームに 100、敗者チームに 99 のダミー点数を書き込む**方針で確定。

- 履歴画面の「0-0 表示」や未入力バッジから区別したい
- 統計（`algorithm.ts` の `stat.points`）への影響スキューは**許容**する（全試合が同一加点になるため、勝率評価に影響はあっても点差評価は元々重視していない）
- 履歴からの詳細スコア編集 (`ScoreInputPage`) は従来どおり。編集時は `scoreA/scoreB` が 0 で初期化されるので 100-99 は上書きされる（既存挙動のまま）

---

## 確定仕様

| 項目 | 仕様 |
|---|---|
| トリガー | `recordScores=ON` かつ試合終了時（変更なし） |
| 表示モーダル | `WinnerSelectModal`（既存未使用コンポーネント） |
| ダブルス | 勝ちペア 2 人選択 → winner 判定 |
| シングルス | 勝者 1 人選択 → winner 判定 |
| 「不明」ボタン | 何もせずモーダルを閉じる（既存 `onSkip` と同等、`scoreA/scoreB=0`、`winner=undefined`） |
| **勝者確定時のスコア** | **勝者側 100 / 敗者側 99** を書き込む |
| winner 判定 | 選択 ID が全員 teamA → `'A'` / 全員 teamB → `'B'` / 混在 → 何もせず閉じる（データ破壊防止） |
| 履歴画面からの編集 | `ScoreInputPage` で初期値 0-0 から再入力（既存挙動、変更なし） |
| 統計 (`algorithm.ts`) | 変更なし。`stat.points` は 100/99 で加算される（許容） |
| CSV/Sheets 出力 | 変更なし。`100-99` がそのまま出力される（許容） |
| `Match` 型 | 変更なし |

---

## 変更対象ファイル

### `src/pages/MainPage.tsx` （唯一の実コード変更）

**1. import 差し替え** — `ScoreInputModal` → `WinnerSelectModal`

**2. `pendingScoreMatch` state に `courtId: number` を追加** (`MainPage.tsx:62-66`)
```ts
const [pendingScoreMatch, setPendingScoreMatch] = useState<{
  matchId: string;
  courtId: number;       // 追加
  teamA: [string, string];
  teamB: [string, string];
} | null>(null);
```

**3. 終了処理で `courtId: court.id` を渡す** (`MainPage.tsx:874-878`)
```ts
setPendingScoreMatch({
  matchId,
  courtId: court.id,     // 追加
  teamA: currentCourt.teamA,
  teamB: currentCourt.teamB,
});
```

**4. モーダル呼び出しを差し替え** (`MainPage.tsx:1232-1249`)
```tsx
{pendingScoreMatch && (
  <WinnerSelectModal
    courtId={pendingScoreMatch.courtId}
    teamA={pendingScoreMatch.teamA}
    teamB={pendingScoreMatch.teamB}
    getPlayerName={(id) => players.find((p) => p.id === id)?.name || '未設定'}
    getPlayerGender={(id) => players.find((p) => p.id === id)?.gender}
    onConfirm={(winnerIds) => {
      if (winnerIds === 'unknown') {
        setPendingScoreMatch(null);
        return;
      }
      const teamASet = new Set(pendingScoreMatch.teamA.filter(Boolean));
      const teamBSet = new Set(pendingScoreMatch.teamB.filter(Boolean));
      const allInA = winnerIds.every((id) => teamASet.has(id));
      const allInB = winnerIds.every((id) => teamBSet.has(id));
      if (!allInA && !allInB) {
        // 混在は安全に無視して閉じる
        setPendingScoreMatch(null);
        return;
      }
      const winner: 'A' | 'B' = allInA ? 'A' : 'B';
      const scoreA = winner === 'A' ? 100 : 99;
      const scoreB = winner === 'B' ? 100 : 99;
      useGameStore.setState((state) => ({
        matchHistory: state.matchHistory.map((m) =>
          m.id === pendingScoreMatch.matchId
            ? { ...m, scoreA, scoreB, winner }
            : m
        ),
      }));
      setPendingScoreMatch(null);
    }}
    onCancel={() => setPendingScoreMatch(null)}
  />
)}
```

### `src/components/ScoreInputModal.tsx`

変更なし。import/呼び出しを削除することで未使用になるが、ファイルは残す（削除は別タスク）。lint の unused-export 警告が出た場合のみ追加対応。

### `src/components/WinnerSelectModal.tsx`

変更なし。既存実装（4 人フラット選択 UI）をそのまま利用。ユーザー確認済み。

---

## 影響範囲まとめ

| ファイル | 変更 |
|---|---|
| `src/pages/MainPage.tsx` | モーダル差し替え、`pendingScoreMatch.courtId`、winner 判定 + 100-99 書き込み |
| `docs/plans/2026-04-20-...` | 新規（本ファイル） |
| `src/lib/algorithm.ts` | **変更なし**（100/99 加算を許容） |
| `src/lib/sheetsApi.ts` | **変更なし**（100-99 出力を許容） |
| `src/pages/HistoryPage.tsx` | **変更なし**（100-99 がバッジ表示される） |
| `src/pages/ScoreInputPage.tsx` | **変更なし**（初期値 0-0 で再入力可能） |
| `src/components/BottomNav.tsx` | **変更なし**（`winner===undefined` のみバッジ計上 = 「不明」のみ未記録扱い） |

---

## 先行プラン (0-0 案) との差分

| 観点 | 0-0 案 (04-19) | 100-99 案（本プラン） |
|---|---|---|
| `scoreA/scoreB` | `0/0` のまま | 勝者 100 / 敗者 99 |
| 履歴画面の表示 | `0 - 0` | `100 - 99`（勝敗が一目で分かる） |
| 統計 `stat.points` | `+0/+0` | `+100/+99`（全試合一律加算） |
| 「不明」時 | `0/0, winner=undefined` | 同左（変更なし） |
| 実装差分 | winner のみ set | winner + scoreA + scoreB set |

---

## 検証手順

### コミット前チェック（CLAUDE.md 必須）
```bash
npm run build
npm run lint
npm run test:run
```

### 手動動作確認
1. ダブルスで試合を開始 → 終了 → モーダルで勝ちペア 2 人を選択 → 確定
   - 履歴画面で該当試合のスコアが `100 - 99`（勝者側に 100）で表示される
   - `winner` バッジが付く
2. シングルスで試合終了 → 勝者 1 人選択 → 確定（同上）
3. 「不明」を押す → スコア `0 - 0`、未入力オレンジバッジが付く（既存挙動）
4. `recordScores=OFF` → モーダル表示なし
5. 履歴の編集ボタン → `ScoreInputPage` が 0-0 から始まる → 21-15 等を入力して保存 → 正しく反映
6. 統計画面で `stat.points` が 100/99 で加算されることを確認（スキュー許容の確認）
7. 混在選択（A から 1 人 + B から 1 人）ができてしまう UI 経路があれば、確定時に何も起きずモーダルが閉じることを確認

### ユニットテスト
- 既存の `algorithm.test.ts` / `gameOperations.test.ts` に回帰がないこと
- 今回の差し替えは UI 層のみなので新規テストは不要

---

## リスク・注意点

1. **統計スキュー** — 全試合一律 `+100/+99` になるため、ポイント合計の相対比較は意味を持つが絶対値は無意味化する。ユーザー合意済み。
2. **「不明」と「記録済み」の区別** — 0-0 は「不明」、100-99 は「勝敗のみ記録」として視覚的に識別可能になる（0-0 案より改善）。
3. **混在選択ガード** — `WinnerSelectModal` 側では防げないので呼び出し側で安全策を入れる。将来 `WinnerSelectModal` をチーム単位カード UI に改修すれば不要になる（本プランではスコープ外）。
4. **`ScoreInputModal` 未使用化** — ファイル残置。完全削除は次タスク。
