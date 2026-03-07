# 流動優先モード時の連続モードブロック閾値修正

## Context
流動優先モード（`prioritizeRotation`）ON時、連続モード（`continuousMatchMode`）のブロック条件で待機人数の閾値が `< 3` だったため、待機4人以上の場合にブロックされず連続ONのままだった。

## 変更内容
閾値を `< 3` → `< 7` に変更。待機メンバーが7人未満の時は流動優先モードで連続モードをブロックする。

### 変更箇所: `src/pages/MainPage.tsx`
1. **useEffect**（L63）: `actualWaiting < 3` → `actualWaiting < 7`
2. **handleContinuousNext**（L284）: `currentActualWaiting < 3` → `currentActualWaiting < 7`
3. **shouldBlockAssignment**（L397）: `waitingCount < 3` → `waitingCount < 7`
4. **shouldBlockContinuous**（L399）: `waitingCount < 3` → `waitingCount < 7`
