# 流動優先モード時の連続モードブロック閾値修正

## Context
流動優先モード（`prioritizeRotation`）ON時、連続モード（`continuousMatchMode`）のブロック条件で待機人数の閾値が `< 3` だったため、待機4人以上の場合にブロックされず連続ONのままだった。

## 変更内容
連続モードのブロック閾値を `< 3` → `< 7` に変更。待機メンバーが7人未満の時は流動優先モードで連続モードをブロックする。
コート配置ブロック（`shouldBlockAssignment`）は別制御で `< 3` のまま維持。

### 変更箇所: `src/pages/MainPage.tsx`
1. **useEffect**（連続モード強制OFF）: `actualWaiting < 3` → `actualWaiting < 7`
2. **handleContinuousNext**（自動配置時の安全チェック）: `currentActualWaiting < 3` → `currentActualWaiting < 7`
3. **shouldBlockContinuous**（連続ボタンのdisabled）: `waitingCount < 3` → `waitingCount < 7`
4. **handleAddCourt**（コート追加時）: `prioritizeRotation` ON時のみ閾値を `< 7` に（OFF時は `< 3`）
5. **shouldBlockAssignment**（コート配置ブロック）: `waitingCount < 3` のまま変更なし
