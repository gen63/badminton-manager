# 試合終了直後のインターフェースを勝敗のみに

**日付**: 2026-04-19
**ステータス**: 確定
**ブランチ**: `claude/add-match-result-interface-ALlKC`

---

## 背景・課題

現在、試合終了時に `recordScores=ON` の場合は `ScoreInputModal` が表示され、
両チームの**点数（数字）を 2 回タップ**して入力する必要がある。

- 試合直後はコートの片付け・次の試合準備で忙しく、詳細スコアまで入力する余裕がない
- 勝敗だけ分かれば十分というケースが多い（統計・勝率計算には `winner` のみで足りる）
- 点数入力を後回しにしたいが、現状は「スキップ」はあるものの `scoreA/scoreB=0, winner=undefined` の「完全未入力」しか選べない

試合直後は**勝敗のみ**を軽量に記録できる UI が欲しい。

---

## 採用アプローチ

既存の未使用コンポーネント **`WinnerSelectModal`** を活用し、試合終了直後のモーダルを
`ScoreInputModal` から `WinnerSelectModal` に差し替える。

- 勝者（ダブルス: 2 人 / シングルス: 1 人）を選択 → `Match.winner = 'A' | 'B'` を記録
- 点数（`scoreA/scoreB`）は 0 のまま
- 「不明」ボタン → `winner` 未設定のまま閉じる（既存の未記録扱い）
- 詳細スコアが必要な場合は従来どおり **履歴画面の編集ボタン → `ScoreInputPage`** で入力

### 検討した他の案

| 案 | 理由 |
|---|---|
| A: `ScoreInputModal` 内に「勝敗のみ」トグルを追加 | UI が複雑化。直後は常に勝敗のみで十分なのでトグル不要 |
| B: モーダルなし（勝敗も後入力） | バッジ依存が増え、履歴画面へ遷移しないと記録できない。勝敗は直後に覚えているうちに記録すべき |
| C: 設定に「勝敗のみ / スコア入力」の 3 値化 | オプションが増える。ユーザー要望は「直後は勝敗のみ」で一貫している |

---

## 確定仕様

| 項目 | 仕様 |
|---|---|
| トリガー | `recordScores=ON` かつ試合終了時（変更なし） |
| 表示モーダル | `WinnerSelectModal`（既存未使用コンポーネント） |
| ダブルス | 勝ちペア 2 人を選択 → `winner='A' or 'B'` を判定 |
| シングルス | 勝者 1 人を選択 → `winner='A' or 'B'` を判定 |
| 「不明」ボタン | 何もせずモーダルを閉じる（既存の `onSkip` と同等） |
| スコア | 常に `0-0` のまま（後編集可能） |
| 履歴画面からの編集 | 従来どおり `ScoreInputPage` で点数入力（変更なし） |
| `recordScores=OFF` | モーダル表示なし（変更なし） |

---

## 設計

### 1. MainPage.tsx の差し替え

**該当箇所**: `src/pages/MainPage.tsx:1232-1249`

現在の `ScoreInputModal` 呼び出しを `WinnerSelectModal` に置換。

```tsx
{pendingScoreMatch && (
  <WinnerSelectModal
    courtId={/* 当該 match.courtId */}
    teamA={pendingScoreMatch.teamA}
    teamB={pendingScoreMatch.teamB}
    getPlayerName={(id) => players.find((p) => p.id === id)?.name || '未設定'}
    getPlayerGender={(id) => players.find((p) => p.id === id)?.gender}
    onConfirm={(winnerIds) => {
      if (winnerIds === 'unknown') {
        setPendingScoreMatch(null);
        return;
      }
      // 選択 ID が teamA に属するか teamB に属するかで winner を判定
      const teamASet = new Set(pendingScoreMatch.teamA.filter(Boolean));
      const winner: 'A' | 'B' = winnerIds.every((id) => teamASet.has(id)) ? 'A' : 'B';
      useGameStore.setState((state) => ({
        matchHistory: state.matchHistory.map((m) =>
          m.id === pendingScoreMatch.matchId ? { ...m, winner } : m
        ),
      }));
      setPendingScoreMatch(null);
    }}
    onCancel={() => setPendingScoreMatch(null)}
  />
)}
```

- `pendingScoreMatch` に `courtId` を保持する必要あり → state の型に `courtId: number` を追加
  （または `courts` から `match.courtId` を逆引きするが、state に持つ方がシンプル）
- `import { ScoreInputModal } ...` を `import { WinnerSelectModal } ...` に変更

### 2. `pendingScoreMatch` 型の拡張

```ts
const [pendingScoreMatch, setPendingScoreMatch] = useState<{
  matchId: string;
  courtId: number;       // ← 追加
  teamA: [string, string];
  teamB: [string, string];
} | null>(null);
```

終了処理内で `setPendingScoreMatch` に `courtId: court.id` を追加（`src/pages/MainPage.tsx:874`）。

### 3. winner 判定ロジック

- ダブルス: `winnerIds` は 2 要素。両方とも `teamA` に含まれれば A 勝ち、そうでなければ B 勝ち
- シングルス: `winnerIds` は 1 要素。`teamA[0]` と一致すれば A 勝ち
- `WinnerSelectModal` 側で「同チームから 2 人」制約は担保されていない。
  念のため実装では「`winnerIds` の全員が teamA にあれば A、全員が teamB にあれば B、
  混在した場合は A/B を判定できないので無視して閉じる」の安全策を入れる

※ 既存の `WinnerSelectModal` の実装は最大 N 人（ダブルス=2, シングルス=1）までしか選択できないが、
「A から 1 人・B から 1 人」の選択を防ぐ制約は UI 上に無い。
→ 本計画では**同チームから選択させる**制約は導入せず、
`winnerIds` が混在したら `winner` 未設定のまま閉じる（データ破壊を防ぐ）。

将来的には `WinnerSelectModal` 側でチーム単位のカード UI にする改善余地あり。今回はスコープ外。

### 4. ScoreInputModal の扱い

- `src/components/ScoreInputModal.tsx` は**残す**（HistoryPage の `ScoreInputPage` 経由で類似機能を使うため、
  完全削除は別タスクとする）
- 本計画では **import と呼び出し箇所のみ削除**。ファイル自体は未使用になるが保持。
  （`npm run lint` で unused-export 警告が出る場合は次のコミットで削除を検討）

### 5. BottomNav バッジ

`src/components/BottomNav.tsx:31` の `m.winner === undefined` による未記録判定は維持。
- 「不明」を選択 → `winner=undefined` のまま → バッジに計上される
- 勝者選択 → `winner='A' or 'B'` → バッジから外れる

この挙動は妥当（「不明」は実質未入力）。

### 6. 設定画面の文言

`src/pages/SettingsPage.tsx:358` の説明文：
- ON: 「終了時に勝敗を記録」 ← そのまま（むしろ実態に一致する）
- OFF: 「勝敗記録なし」 ← そのまま

文言変更不要。

### 7. オンライン同期

`onConfirm` 内の `useGameStore.setState` は既存の sync 機構（useFirebaseSync の hash diff 検知）で
Firestore に伝播する。現状の `ScoreInputModal` の onConfirm と同じ経路・同じ粒度なので追加対応不要。

---

## 実装ステップ

### Step 1: MainPage.tsx の修正
- `ScoreInputModal` import を `WinnerSelectModal` に変更
- `pendingScoreMatch` state に `courtId: number` を追加
- `setPendingScoreMatch({ ..., courtId: court.id })` を終了処理に追加
- モーダル呼び出しを `WinnerSelectModal` に差し替え、winner 判定ロジックを実装

### Step 2: 動作確認
- `npm run build`（型チェック + ビルド）
- `npm run lint`
- `npm run test:run`

### Step 3: 手動確認ポイント
- ダブルスで試合終了 → モーダルが勝ちペア選択に変わっている
- シングルスで試合終了 → 勝者 1 人選択
- 勝者選択 → 確定 → 履歴画面でスコア `0-0`、勝者チームが左に表示される（既存の `MatchCard` ロジック）
- 「不明」ボタン → 履歴に「未入力」オレンジ表示
- `recordScores=OFF` → モーダル表示なし（変更なし）
- 履歴の編集ボタン → `ScoreInputPage` で点数入力可能（変更なし）

---

## 影響範囲

| ファイル | 変更内容 |
|---|---|
| `src/pages/MainPage.tsx` | モーダル差し替え、`pendingScoreMatch.courtId` 追加、winner 判定ロジック |
| `src/components/ScoreInputModal.tsx` | 使用箇所なし（ファイル自体は残置。削除は別タスク） |
| `src/components/WinnerSelectModal.tsx` | 既存のまま使用（変更なし） |

---

## リスク・注意点

1. **同チームから選択させる制約の不在**
   → `winnerIds` 混在時は winner 未設定にして閉じる安全策を実装。
   ただし UX としては改善余地あり（将来タスク）。
2. **ScoreInputModal が未使用になる**
   → ファイル自体は残すが lint 警告が出るなら削除を検討。
3. **既存の試合履歴への影響なし**
   → `Match` 型は変更しない。過去のスコア付きレコードは従来どおり表示される。
