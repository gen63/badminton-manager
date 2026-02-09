# 連続試合モード

## 概要

試合終了時に、次の試合の配置と開始を自動で行う「連続試合モード」を追加する。

## 背景・動機

現在の試合終了フローは以下の通り：

1. ユーザーが「終了」をタップ
2. コートがクリアされる
3. ユーザーが手動で「配置」をタップ
4. ユーザーが手動で「開始」をタップ

練習中は運営者が忙しく、手動操作を減らしたいというニーズがある。
連続試合モードがONの場合、手順3-4を自動化する。

## 設計

### 設定の追加

`settingsStore` に `continuousMatchMode: boolean` を追加する。

```typescript
interface SettingsState {
  // 既存
  gasWebAppUrl: string;
  useStayDurationPriority: boolean;
  // 新規
  continuousMatchMode: boolean;
  setContinuousMatchMode: (value: boolean) => void;
}
```

デフォルト値: `false`（既存の動作を維持）

### 試合終了時の自動処理

`MainPage.tsx` の `handleFinishGame` を拡張：

```
handleFinishGame(courtId)
  → finishGame()         // Match記録作成
  → updatePlayer() × 4  // 統計更新
  → 休憩復帰処理
  → updateCourt()        // コートクリア
  → if (continuousMatchMode) {
      handleContinuousNext(courtId)  // 自動配置＋開始
    }
```

### 重要: ストア直接読み取り

`handleFinishGame` 内の各 `set()` はZustandで同期的に処理されるが、
Reactコンポーネントの変数（`players`, `courts`）は再レンダリングまで古い。

**解決策**: 自動配置ロジックでは `useGameStore.getState()` / `usePlayerStore.getState()` で
最新のストア状態を直接読み取る。

```typescript
const handleContinuousNext = (courtId: number) => {
  const { courts, matchHistory, updateCourt, startGame } = useGameStore.getState();
  const { players } = usePlayerStore.getState();
  const settings = useSettingsStore.getState();

  // 最新の待機プレイヤーを計算
  const playersInCourts = new Set(
    courts.flatMap(c => [...c.teamA, ...c.teamB]).filter(id => id?.trim())
  );
  const waitingPlayers = players.filter(
    p => !p.isResting && !playersInCourts.has(p.id)
  );

  if (waitingPlayers.length < 4) {
    toast.error('待機中のプレイヤーが足りません');
    return;
  }

  // 配置アルゴリズム実行
  const assignments = assignCourts(waitingPlayers, 1, matchHistory, { ... });

  if (assignments[0]) {
    updateCourt(courtId, { teamA, teamB, ... });
    startGame(courtId);
  }
};
```

### エッジケース

| ケース | 挙動 |
|--------|------|
| 待機者が4人未満 | トースト通知「待機中のプレイヤーが足りません」、コートは空のまま |
| 複数コートが同時終了 | 各コートが独立して自動配置。先に処理されたコートが待機者を消費 |
| 配置アルゴリズムがエラー | トースト通知でエラー表示、コートは空のまま |

### UI変更

#### メインページ（MainPage.tsx）

ヘッダーの「一括配置」ボタンの左に「連続」ボタンを配置。
単一ボタンの状態変化でON/OFFを表現する：

- **OFF**: 通常のセカンダリボタンスタイル（グレー系）
- **ON**: 緑背景+白文字でアクティブ状態を視覚化

アイコン: Repeat（リピートアイコン）

## 変更対象ファイル

1. `src/stores/settingsStore.ts` - 設定追加
2. `src/pages/MainPage.tsx` - ボタンUI + 自動配置ロジック追加

## スコープ外

- 自動配置の遅延/アニメーション（将来的に検討）
- 試合前の確認ダイアログ（即座に開始することが目的なので不要）
