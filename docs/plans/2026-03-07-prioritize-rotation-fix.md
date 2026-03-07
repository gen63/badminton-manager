# 流動優先モード: ブロック条件改善 & 連続モード競合修正

## Context
流動優先モード（`prioritizeRotation`）は配置をブロックし、プレイヤーの入れ替わりを最大化する設計。

**問題1: ブロック条件が3コート以上で不適切**
現在の「過半数ルール」(`emptyCourts <= playingCourts`) は2コート用の設計。
3コート15人で1コート終了時、7人待機でもブロックされてしまう。

**問題2: 連続モードONで流動優先が無効化される**
`!continuousMatchMode`条件により、連続モードONだとブロックが一切効かない。

## 変更内容

### `src/pages/MainPage.tsx`

#### 1. ブロック条件を「元の待機人数」ベースに変更
コート終了前の待機人数(`activePlayers - courts.length * 4`)が3人未満の場合のみブロック。
十分な待機人数がいる場合はローテーションが自然に回るためブロック不要。

```diff
- const shouldBlockAssignment = prioritizeRotation && !continuousMatchMode
-   && playingCourts.length > 0 && emptyCourts.length <= playingCourts.length;
+ const originalWaiting = activePlayers.length - courts.length * 4;
+ const shouldBlockAssignment = prioritizeRotation
+   && playingCourts.length > 0 && emptyCourts.length > 0 && originalWaiting < 3;
```

| シナリオ | 元の待機 | ブロック？ |
|----------|---------|-----------|
| 10人/2コート/1終了 | 2人 | YES |
| 12人/2コート/1終了 | 4人 | NO |
| 14人/3コート/1終了 | 2人 | YES |
| 15人/3コート/1終了 | 3人 | NO |

#### 2. ブロック発動時に連続モードを強制OFF
```typescript
useEffect(() => {
  if (shouldBlockAssignment && continuousMatchMode) {
    setContinuousMatchMode(false);
  }
}, [shouldBlockAssignment, continuousMatchMode, setContinuousMatchMode]);
```

#### 3. `handleContinuousNext`にもブロックチェック追加（安全策）
useEffectの非同期タイミングの隙間をカバー。

```typescript
// handleContinuousNext冒頭に追加
const currentEmpty = currentCourts.filter(c => !c.teamA[0] || c.teamA[0] === '');
const currentPlaying = currentCourts.filter(c => c.isPlaying);
const currentActive = currentPlayers.filter(p => !p.isResting);
const origWaiting = currentActive.length - currentCourts.length * 4;
if (pr && currentPlaying.length > 0 && currentEmpty.length > 0 && origWaiting < 3) {
  setContinuousMatchMode(false);
  return;
}
```

#### 4. ブロック中メッセージの改善
空きコートに表示されるメッセージを、流動性確保の説明 + 一括配置への誘導に変更。

**ヘッダー横**（L566-568）:
```diff
- <span>他コート終了後に配置</span>
+ <span>流動性確保のため待機中</span>
```

**空きコート内**（L727-728）:
```diff
- <p>試合終了を待機中...</p>
+ <p>他コート終了後に一括配置してください</p>
```

#### 5. 一括配置時に練習を自動スタート
`handleAutoAssign` で `courtId` が未指定（一括配置）の場合、配置と同時に `isPlaying: true` + `startedAt: Date.now()` をセット。

```diff
  assignments.forEach((assignment) => {
    updateCourt(assignment.courtId, {
      teamA: assignment.teamA,
      teamB: assignment.teamB,
      scoreA: 0,
      scoreB: 0,
-     isPlaying: false,
-     startedAt: null,
+     isPlaying: !courtId,      // 一括配置時は自動スタート
+     startedAt: !courtId ? Date.now() : null,
      finishedAt: null,
    });
  });
```

個別コートの「配置」ボタン（`courtId` あり）は従来通り手動スタート。

## 検証
- `npm run lint` / `npm run build` 成功
- 10人/2コート: 1コート終了時にブロック、全コート終了で配置可能
- 15人/3コート: 1コート終了時にブロックされずに配置可能
- 14人/3コート: 1コート終了時にブロック（元の待機2人）
- 連続モードON + ブロック条件成立時: 連続モードが強制OFFになる
- ブロック中の空きコートに一括配置への誘導メッセージが表示される
- 一括配置ボタン押下: 配置と同時に全コートが練習開始状態になる
- 個別コート配置ボタン押下: 従来通り練習は手動スタート
