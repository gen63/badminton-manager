# べき等な試合終了 + 連続モード配置

## 課題

2人のユーザーが同じ試合の「終了」を同時にタップすると:
- 試合記録が重複 or 消失
- 次の配置が2回実行され、異なるメンバーが選ばれる
- 片方の端末が不整合状態で固まる

## 解決方針

**案K + 楽観的ローカル更新の折衷案**

1. ローカルでは即座に状態更新（現在と同じUX）
2. Firestore Transactionで `startedAt` をべき等キーとしてチェック
3. 2人目の push は `already_finished` → ローカル状態をonSnapshotで修正

## 実装ステップ

### Step 1: 純粋関数 `computeFinishAndContinue` の作成

**ファイル:** `src/lib/gameOperations.ts`（新規）

試合終了 + プレイヤー更新 + 連続モード配置 をリモート状態に対して計算する純粋関数。

```typescript
import type { Player } from '../types/player';
import type { Court } from '../types/court';
import type { Match } from '../types/match';
import type { Reservation } from '../types/reservation';
import { assignCourts } from './algorithm';

export interface GameState {
  players: Player[];
  courts: Court[];
  matchHistory: Match[];
  reservations: Reservation[];
}

export interface FinishGameResult {
  newState: GameState;
  continuousNextApplied: boolean;
  continuousError?: string;
}

/**
 * 試合終了 + 連続モード配置 を純粋関数として計算。
 * リモート状態に対して適用し、Transactionで使用する。
 */
export function computeFinishAndContinue(
  state: GameState,
  courtId: number,
  options: {
    continuousMatchMode: boolean;
    useStayDurationPriority: boolean;
    prioritizeDiversity: boolean;
    gameMode: 'singles' | 'doubles';
  }
): FinishGameResult {
  const court = state.courts.find(c => c.id === courtId);
  if (!court || !court.isPlaying) {
    return { newState: state, continuousNextApplied: false };
  }

  const now = Date.now();

  // 1. 試合記録を作成
  const match: Match = {
    id: crypto.randomUUID(),
    courtId,
    teamA: court.teamA,
    teamB: court.teamB,
    scoreA: 0,
    scoreB: 0,
    startedAt: court.startedAt > 0 ? court.startedAt : now,
    finishedAt: now,
  };

  // 2. プレイヤーの統計を更新
  const activePlayerIds = [...court.teamA, ...court.teamB].filter(id => id);
  let updatedPlayers = state.players.map(p => {
    if (activePlayerIds.includes(p.id)) {
      return { ...p, gamesPlayed: p.gamesPlayed + 1, lastPlayedAt: now };
    }
    return p;
  });

  // 3. restingPlayerIds の復元
  if (court.restingPlayerIds && court.restingPlayerIds.length > 0) {
    updatedPlayers = updatedPlayers.map(p => {
      if (court.restingPlayerIds!.includes(p.id)) {
        return { ...p, isResting: true };
      }
      return p;
    });
  }

  // 4. コートをクリア
  let updatedCourts = state.courts.map(c =>
    c.id === courtId
      ? { ...c, teamA: ['', ''] as [string, string], teamB: ['', ''] as [string, string],
          scoreA: 0, scoreB: 0, isPlaying: false, startedAt: 0, finishedAt: 0, restingPlayerIds: [] }
      : c
  );

  const updatedMatchHistory = [...state.matchHistory, match];

  // 5. 連続モード配置
  let continuousNextApplied = false;
  let continuousError: string | undefined;

  if (options.continuousMatchMode) {
    const playersPerCourt = options.gameMode === 'singles' ? 2 : 4;
    const playersInCourts = new Set(
      updatedCourts.flatMap(c => [...c.teamA, ...c.teamB]).filter(id => id?.trim())
    );
    const waitingPlayers = updatedPlayers.filter(
      p => !p.isResting && !playersInCourts.has(p.id)
    );

    // ブロックチェック
    if (options.prioritizeDiversity) {
      const occupied = updatedCourts.filter(c => c.isPlaying || (c.teamA[0] && c.teamA[0] !== ''));
      const active = updatedPlayers.filter(p => !p.isResting);
      const actualWaiting = active.length - occupied.length * playersPerCourt;
      const threshold = options.gameMode === 'singles' ? 3 : 7;
      if (occupied.length > 0 && actualWaiting < threshold) {
        continuousError = 'diversity_block';
        // continuousMatchMode をOFFにする処理は呼び出し側で行う
      }
    }

    if (!continuousError) {
      const minWaiting = options.gameMode === 'singles' ? 3 : 7;
      if (waitingPlayers.length < minWaiting) {
        continuousError = 'not_enough_players';
      }
    }

    if (!continuousError) {
      const assignments = assignCourts(waitingPlayers, 1, updatedMatchHistory, {
        targetCourtIds: [courtId],
        totalCourtCount: updatedCourts.length,
        useStayDurationPriority: options.useStayDurationPriority,
        reservations: state.reservations,
        gameMode: options.gameMode,
      });

      if (assignments[0]) {
        const assignment = assignments[0];
        updatedCourts = updatedCourts.map(c =>
          c.id === courtId
            ? { ...c, teamA: assignment.teamA, teamB: assignment.teamB,
                scoreA: 0, scoreB: 0, isPlaying: true, startedAt: Date.now(), finishedAt: 0 }
            : c
        );
        continuousNextApplied = true;
      } else {
        continuousError = 'assignment_failed';
      }
    }
  }

  return {
    newState: {
      players: updatedPlayers,
      courts: updatedCourts,
      matchHistory: updatedMatchHistory,
      reservations: state.reservations,
    },
    continuousNextApplied,
    continuousError,
  };
}
```

### Step 2: `finishGameTransaction` の作成

**ファイル:** `src/services/sessionService.ts` に追加

```typescript
/**
 * べき等な試合終了Transaction
 * startedAt をべき等キーとして、同じ試合の二重終了を防ぐ
 */
export async function finishGameTransaction(
  sessionId: string,
  courtId: number,
  matchStartedAt: number,
  computeNewState: (remoteState: GameState) => GameState,
): Promise<'success' | 'already_finished'> {
  if (!useFirestore) return 'success';

  const docRef = doc(db!, 'sessions', sessionId);

  try {
    return await runTransaction(db!, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (!snap.exists()) throw new Error('Session not found');

      const data = snap.data();
      const remoteState = data.gameState as GameState;
      const remoteCourt = remoteState.courts.find(c => c.id === courtId);

      // べき等チェック: この試合がまだ進行中か？
      if (!remoteCourt?.isPlaying || remoteCourt.startedAt !== matchStartedAt) {
        return 'already_finished';
      }

      // リモート状態に対して新しい状態を計算
      const newState = computeNewState(remoteState);

      transaction.update(docRef, {
        gameState: sanitize(newState),
        updatedAt: serverTimestamp(),
      });

      return 'success';
    });
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === 'aborted') {
      throw new SessionError(
        '他のユーザーが更新しました。もう一度お試しください',
        'conflict'
      );
    }
    throw error;
  }
}
```

### Step 3: MainPage の「終了」ボタンハンドラを修正

**ファイル:** `src/pages/MainPage.tsx`

```typescript
onClick={async () => {
  const currentCourt = courts.find((c) => c.id === court.id);
  if (!currentCourt) return;

  // べき等キーをキャプチャ
  const matchStartedAt = currentCourt.startedAt;

  // ① 楽観的ローカル更新（現在と同じ）
  pushUndo();
  finishGame(court.id, 0, 0);
  [...court.teamA, ...court.teamB].filter(id => id).forEach((playerId) => {
    const player = players.find((p) => p.id === playerId);
    if (player) {
      updatePlayer(playerId, {
        gamesPlayed: player.gamesPlayed + 1,
        lastPlayedAt: Date.now(),
      });
    }
  });
  if (court.restingPlayerIds && court.restingPlayerIds.length > 0) {
    court.restingPlayerIds.forEach((playerId: string) => {
      updatePlayer(playerId, { isResting: true });
    });
  }
  updateCourt(court.id, {
    teamA: ['', ''], teamB: ['', ''],
    scoreA: 0, scoreB: 0, isPlaying: false, startedAt: 0, finishedAt: 0, restingPlayerIds: [],
  });
  if (continuousMatchMode) {
    handleContinuousNext(court.id);
  }

  // ② オンラインモード: べき等Transaction
  if (session?.id && session?.createdBy) {
    const { finishGameTransaction } = await import('../services/sessionService');
    const result = await finishGameTransaction(
      session.id,
      court.id,
      matchStartedAt,
      (remoteState) => {
        const { computeFinishAndContinue } = require('../lib/gameOperations');
        return computeFinishAndContinue(remoteState, court.id, {
          continuousMatchMode,
          useStayDurationPriority,
          prioritizeDiversity,
          gameMode: session?.config.gameMode ?? 'doubles',
        }).newState;
      }
    );

    if (result === 'already_finished') {
      toast.info('他のユーザーが既に終了しました');
      // onSnapshot で最新状態が届き、ローカルは自動修正される
    }
  }
}}
```

### Step 4: useFirebaseSync の修正

**ファイル:** `src/hooks/useFirebaseSync.ts`

finishGameTransaction が直接 Firestore を更新するため、通常の schedulePush と二重になるのを防ぐ。

1. finishGameTransaction 成功後、`lastPushedHash` と `lastPushedTime` を更新して、
   schedulePush のデバウンス中のpushが不要な上書きをしないようにする。

2. `already_finished` 時は `isSyncingFromRemote` を一時的に true にして、
   ローカルの楽観的更新が再pushされないようにし、次の onSnapshot で上書きを受け入れる。

方法: useFirebaseSyncから公開する `skipNextPush()` 関数、
または `finishGameTransaction` 成功時に全ストアの状態を再取得して hash を更新。

具体的には:
- finishGameTransaction 成功 → 通常の schedulePush をキャンセル（pushTimer をクリア）
  + lastPushedHash を更新（Transaction が書いた状態のハッシュ）
- already_finished → `isSyncingFromRemote = true` にして楽観的更新の push を抑止
  + 次の onSnapshot で自動修正

### Step 5: テスト

**ファイル:** `src/lib/gameOperations.test.ts`（新規）

`computeFinishAndContinue` の単体テスト:
- 通常の試合終了
- 連続モード配置
- 待機人数不足時
- diversity block 時
- restingPlayerIds の復元

## ファイル変更一覧

| ファイル | 変更内容 |
|---------|---------|
| `src/lib/gameOperations.ts` | **新規** 純粋関数 |
| `src/lib/gameOperations.test.ts` | **新規** テスト |
| `src/services/sessionService.ts` | `finishGameTransaction` 追加 |
| `src/pages/MainPage.tsx` | 終了ボタンハンドラ修正 |
| `src/hooks/useFirebaseSync.ts` | push抑制の公開API追加 |

## 動作フロー

```
User X タップ「終了」        User Y タップ「終了」
       │                            │
       ▼                            ▼
 ① ローカル楽観更新           ① ローカル楽観更新
 (即座にUIに反映)             (即座にUIに反映)
       │                            │
       ▼                            ▼
 ② Transaction開始            ② Transaction開始
 read: court.isPlaying=true   read: court.isPlaying=true
 startedAt=1710500000 ✅      startedAt=1710500000 ✅
 → 新状態を計算・書き込み     → Transactionリトライ
       │                            │
       ▼                            ▼
 ③ Transaction成功            ③ リトライ時:
 Firestore更新済み             read: court.isPlaying=false
       │                       startedAt≠1710500000
       │                       → 'already_finished' 返却
       │                            │
       ▼                            ▼
 onSnapshot → 両端末に配信    ④ toast「他のユーザーが既に終了しました」
       │                       isSyncingFromRemote=true
       ▼                            │
 User X: hash一致→SKIP              ▼
 User Y: リモート状態を適用    ⑤ onSnapshot → Xの結果で上書き
         → UIが正しい状態に        → 両端末で同じ状態 ✅
```
