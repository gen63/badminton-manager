# セッション自動アーカイブ（12時間フィルタ）

## Context

セッション一覧は現状 `listRecentActiveSessions(5)` で `updatedAt` 降順の最新5件を返す。
古い練習セッションもそのまま表示され続けるため、見やすさと誤参加を防ぐ目的で
以下の条件で自動的に一覧から除外（=アーカイブ）する。

**可視条件:**
- 試合がまだ開始されていない（`matchHistory` が空） **OR**
- 最初の試合開始から 12 時間以内

**非可視条件（アーカイブ扱い）:**
- 最初の試合開始から 12 時間以上経過

アーカイブ閲覧UI・手動アーカイブ/復活機能は本プランでは実装しない
（filter条件を満たさないセッションは一覧から消えるが、セッションIDで直接アクセスすれば引き続き利用可能）。

## 設計方針

**`firstMatchStartedAt` を Session 型のトップレベルに非正規化する。**
- `gameState.matchHistory[].startedAt` から導出可能だが、`docToSession` は `gameState` を展開しないため、一覧取得時の判定に使えない
- トップレベルに持てば Firestore read 効率もよい

**書き込みタイミング:** `matchHistory` が更新される **3つの書き込み経路すべて** で
`min(startedAt)` を計算して同トランザクション内で書き込む。空なら `null`。

| 関数 | 用途 | 試合追加 |
|---|---|---|
| `syncGameState` | gameState全体書き込み（export済み） | あり |
| `syncGameStateWithTransaction` | 3-wayマージ付き同期（主経路） | あり |
| `finishGameTransaction` | 試合終了の原子的書き込み（最頻） | あり |

`finishGameTransaction` への追加が漏れると、試合終了直後に `firstMatchStartedAt`
が反映されず「最新セッションが12h判定外」状態になる可能性があるため、重要。

**フィルタ方式:** クライアント側で filter。
- Firestore OR query はインデックス要件が発生するため避ける
- 上限 `limit(50)` で十分（同時アクティブが50を大幅に超えるとは想定しない）

**ロジックは別モジュール（`src/lib/sessionArchive.ts`）に切り出す。**
- pure関数化してユニットテストしやすくする
- 3つの書き込み経路から同じ関数を呼ぶので共通化

## 変更ファイル一覧

### 1. `src/types/session.ts` — Session型に追加

```ts
export interface Session {
  // 既存フィールド...
  firstMatchStartedAt?: number | null; // 最初の試合開始時刻（nullまたは未設定=試合未開始）
}
```

### 2. `src/lib/sessionArchive.ts` (新規) — pure関数

```ts
import type { Match } from '../types/match';
import type { Session } from '../types/session';

export const ARCHIVE_THRESHOLD_MS = 12 * 60 * 60 * 1000;

export function computeFirstMatchStartedAt(matches: Match[]): number | null {
  if (matches.length === 0) return null;
  return Math.min(...matches.map((m) => m.startedAt));
}

export function isSessionVisible(
  session: Pick<Session, 'firstMatchStartedAt'>,
  now: number = Date.now(),
): boolean {
  if (!session.firstMatchStartedAt) return true;
  return session.firstMatchStartedAt > now - ARCHIVE_THRESHOLD_MS;
}
```

### 3. `src/services/sessionService.ts` — 4箇所の変更

**import追加:**
```ts
import { computeFirstMatchStartedAt, isSessionVisible } from '../lib/sessionArchive';
```

**a. `docToSession` (line 61-78):**
```ts
firstMatchStartedAt: (data.firstMatchStartedAt as number | null | undefined) ?? null,
```

**b. `syncGameState` (line 296-309) の updateDoc:**
```ts
await updateDoc(docRef, {
  gameState: sanitize(gameState),
  registeredPlayers,
  firstMatchStartedAt: computeFirstMatchStartedAt(gameState.matchHistory),
  updatedAt: serverTimestamp(),
});
```

**c. `syncGameStateWithTransaction` (line 351-356) の transaction.update:**
```ts
transaction.update(docRef, {
  gameState: sanitize(finalState),
  registeredPlayers,
  firstMatchStartedAt: computeFirstMatchStartedAt(finalState.matchHistory),
  updatedAt: serverTimestamp(),
});
```
※ マージ後の `finalState.matchHistory` を使う点に注意。

**d. `finishGameTransaction` (line 409-412) の transaction.update:**
```ts
transaction.update(docRef, {
  gameState: sanitize(newState),
  firstMatchStartedAt: computeFirstMatchStartedAt(newState.matchHistory),
  updatedAt: serverTimestamp(),
});
```

**e. `listRecentActiveSessions` (line 451-464):**
```ts
export async function listRecentActiveSessions(count = 50): Promise<Session[]> {
  if (!useFirestore) return [];
  const q = query(
    collection(db!, 'sessions'),
    orderBy('updatedAt', 'desc'),
    limit(count),
  );
  const snapshot = await getDocs(q);
  return snapshot.docs
    .map((snap) => docToSession(snap.id, snap.data()))
    .filter((s) => isSessionVisible(s));
}
```

### 4. `src/pages/SessionSelectPage.tsx`

line 40: `listRecentActiveSessions(5)` → `listRecentActiveSessions()`（デフォルト50）。

### 5. `src/lib/sessionArchive.test.ts` (新規)

`isSessionVisible`:
- `firstMatchStartedAt` が undefined → true（試合未開始）
- `firstMatchStartedAt` が null → true
- 11時間59分前 → true
- ちょうど12時間前（`now - ARCHIVE_THRESHOLD_MS`）→ false（厳密 `>`）
- 12時間1秒前 → false
- 未来時刻（時計ずれ） → true

`computeFirstMatchStartedAt`:
- 空配列 → null
- 単一試合 → その `startedAt`
- 複数試合（順不同）→ min

## 後方互換

- 既存Firestoreドキュメント（`firstMatchStartedAt` なし）は `docToSession` で `null` に正規化 → 「試合未開始」扱いで常に表示。次回のsync/試合終了で値がセットされる
- 「試合リセット」で `matchHistory` が空になった場合、次回sync時に `firstMatchStartedAt=null` に戻り、再び一覧に表示される（仕様として妥当）
- 新フィールド追加のみで既存読み込み経路には影響しない

## 検証方法

1. `npm run build` — 型チェック + ビルド
2. `npm run lint`
3. `npm run test:run`（`sessionArchive.test.ts` を含めた全テスト通過）
4. 手動確認:
   - 試合ゼロの新規セッション → 一覧表示
   - 試合を1回行い、Firestoreドキュメントに `firstMatchStartedAt` が書かれる
   - Firebase consoleで `firstMatchStartedAt` を 13h前に手動変更 → 一覧から消える
   - セッションIDで直接アクセスは引き続き可能
   - 「試合リセット」後に再び一覧に出る

## 注意点

- **セッションIDで直接アクセス可能**: アーカイブされても `SessionJoinPage` 経由で参加できる。これは意図した挙動（一覧UIが混雑しないことが目的）
- **手動アーカイブ/復活は未実装**: 将来必要なら `archived: boolean` フラグと管理者UIを追加可能
- **時計ずれ**: `Match.startedAt` はクライアント時刻、`Date.now()` は閲覧クライアント時刻。最大で数分〜数時間のずれが起きうるが、`match.startedAt` の既存性質なので新規問題ではない
- **limit(50)**: 十分な上限。50件を超える並行アクティブは想定しない
