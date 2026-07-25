# 参加者管理ページに「最終画面参照からの経過時間」を表示（管理者以上）

## Context

セッション運営中、管理者は「誰がアプリを見ていないか（周知事項や自分の配置に気づいていないか）」
を把握したい。現状 `presence`（`docs/plans/2026-04-21-presence-indicator.md`）は
**在席中のユーザーだけ**を表す揮発データで、離脱時に `clearPresence` でエントリ自体が
削除される。そのため「最後に見てから何分経ったか」は既存データからは復元できない。

そこで **削除されない別フィールド `lastSeen`** を追加し、参加者管理ページ
（`src/pages/PlayerSelect.tsx`）の各参加者カードに経過時間を表示する。

## 仕様

- **対象ページ**: 参加者管理ページ（`/players`）のみ
- **表示権限**: `useSessionStore.isAdmin()` が true のときのみ（creator / `admins` / dev モード）。
  一般ユーザには一切表示しない（DOM にも出さない）。
- **計測範囲**: **アプリ全ページ**。「画面を見ている」の自然な解釈に合わせ、MainPage 限定の
  `presence` とは別に、App ルートでハートビートする。タブが `hidden` の間は「見ていない」扱い。
- **表示内容**（参加者名 = `currentUser` 名で突き合わせ）:
  | 状態 | 条件 | ラベル | 色 |
  |---|---|---|---|
  | 閲覧中 | `now - lastSeen <= 90s` | `閲覧中` | `text-emerald-600` |
  | 直近 | `< 15分` | `N分前` | `text-muted-foreground` |
  | 放置 | `15分以上` | `N分前` | `text-amber-600` |
  | 記録なし | `lastSeen` エントリ無し | `未閲覧` | `text-muted-foreground` |

  （`never` は当初 `/60` を想定したが DESIGN.md のコントラスト比を下回るおそれがあり、
  ラベル文字列で `recent` と十分に区別できるため通常の muted 色にした）
- 表示は**分単位のみ**。実運用で 100 分以上放置されるケースは想定しないため時間/日表記は持たない。
- 相対時間なので **30秒ごとに再評価**（`PresenceIndicator` と同じ tick 方式、間隔だけ長い）。

## データモデル

```ts
// src/types/session.ts
export interface Session {
  // ...既存
  /** 最終画面参照時刻 (Unix ms, クライアント時刻)。presence と違い削除しない */
  lastSeen?: { [username: string]: number };
}
```

- `presence` は「今いる人」、`lastSeen` は「最後にいた時刻」。**役割を分離**し、既存
  `presence` のセマンティクス（離脱で削除 → インジケータ即消え）は一切変更しない。
- キーはユーザー名。`.` を含む名前でも壊れないよう書き込みは **`FieldPath` を使用**。
- `updatedAt` は**絶対に更新しない**（TTL カウント継続 & `applyRemoteData` の無駄実行回避。
  既存 `writePresence` と同じ方針）。

## 実装ステップ

### 1. 型定義（`src/types/session.ts`）

- `Session.lastSeen?: { [username: string]: number }` を追加（コメント付き）。

### 2. サービス層（`src/services/sessionService.ts`）

- `docToSession`（L138 付近）に `lastSeen: data.lastSeen as Session['lastSeen']` を追加。
- 新規 `writeLastSeen(sessionId: string, username: string, at: number): Promise<void>`
  - `if (!db) return;` / `if (!sessionId || !username) return;`（既存 presence 関数と同形）
  - `updateDoc(ref, new FieldPath('lastSeen', username), at)`
  - `updatedAt` は付けない。失敗は `console.warn('[LastSeen] ...')` のみ（補助機能）。
- **削除関数は作らない**（履歴として残すのが目的）。プルーニングもしない
  （参加者数 × number = 数百バイト規模、セッション TTL で消える）。

### 3. ストア（`src/stores/presenceStore.ts`）

`presence` と同じ揮発ストアに同居させる（`sessionStore` は persist されるため使わない）。

```ts
interface PresenceState {
  remotePresence: PresenceMap;
  lastSeen: { [username: string]: number };
  /** onSnapshot 1 回で両方まとめて更新（再レンダー 1 回に抑える） */
  setPresenceSnapshot: (snapshot: { presence: PresenceMap; lastSeen: { [k: string]: number } }) => void;
  clear: () => void;
}
```

- 既存 `setRemotePresence` は `setPresenceSnapshot` に置き換える（呼び出し元は
  `useFirebaseSync` の 1 箇所のみ）。`clear()` は両方を `{}` に戻す。

### 4. 同期（`src/hooks/useFirebaseSync.ts` L166-169）

- `setRemotePresence(...)` 呼び出しを
  `setPresenceSnapshot({ presence: (data.presence ?? {}), lastSeen: (data.lastSeen ?? {}) })`
  に差し替える（`as Session['...']` キャストは既存スタイルに合わせる）。

### 5. ハートビートフック（新規 `src/hooks/useLastSeen.ts`）

`usePresence`（MainPage 限定）とは別物。**App ルートで常時稼働**させる。

- シグネチャ: `useLastSeen(): void` — 内部で `useSessionStore` から
  `session?.id` と `currentUser` を購読（`useFirebaseSync` と同じスタイル）。
- どちらか無ければ完全に no-op。
- 動作:
  - マウント時 & `visibilitychange → visible` 時: 即 `writeLastSeen(id, user, Date.now())`
  - `setInterval(60_000)` でハートビート。**`document.visibilityState !== 'visible'` ならスキップ**。
    直近書き込みから 30 秒以内ならスキップ（`ref` 管理）。
  - `visibilitychange → hidden` / `beforeunload`: 「離脱時刻」を残すため最後に 1 回書き込む
    （fire-and-forget。完了保証なしでも、直近ハートビートとの差は最大 60 秒なので許容）。
  - unmount 時: interval / listener 解除のみ（`presence` と違い削除書き込みはしない）。
- エラーはすべて `writeLastSeen` 内で warn 済み。

### 6. App ルートへの組み込み（`src/components/FirebaseSyncMount.tsx`）

- `useFirebaseSync()` の直後に `useLastSeen()` を呼ぶ。
  ページ遷移でアンマウントされない位置なので、全ページで計測が継続する。
- JSDoc に「lastSeen ハートビートもここで起動する」旨を追記。

### 7. 表示ロジック（新規 `src/lib/lastSeen.ts` + テスト）

```ts
export type LastSeenTone = 'live' | 'recent' | 'stale' | 'never';
export interface LastSeenView { label: string; tone: LastSeenTone; }
export function formatLastSeen(lastSeenAt: number | undefined, now: number): LastSeenView;
```

- `undefined` / 数値でない → `{ label: '未閲覧', tone: 'never' }`
- 未来時刻（クライアント時計ずれ）→ `live` 扱い（負値を表示しない）
- `diff <= 90_000` → `{ '閲覧中', 'live' }`
- `diff < 15分` → `{ 'N分前', 'recent' }`（`Math.floor(diff / 60_000)`、0 分は 90 秒閾値で到達しない）
- `15分 <= diff` → `{ 'N分前', 'stale' }`（分表記のみ。100分以上の放置は想定しないため時間/日表記は持たない）
- `src/lib/lastSeen.test.ts` で各境界（90s 前後 / 15分 / undefined / 未来 / 60分超でも分表記のまま）を網羅。

### 8. 参加者カードへの組み込み（`src/pages/PlayerSelect.tsx`）

- `usePresenceStore((s) => s.lastSeen)` を購読。
- 相対時間の再評価用に 30 秒 tick（`useState` + `useEffect`/`setInterval`）。
  **`isAdmin` が false のときは interval を張らない**（無駄な再レンダー回避）。
- **カードを縦2行構成に変更**し、経過時間は 2 行目に置く。1 行目（名前 + 編集/削除 + 試合数 +
  支払 + 名簿）に差し込む案は iPhone 375px 幅で破綻するため採らない:
  - 内容幅の実測見積り: `max-w-md p-3` → 351px → `.card p-4` → 319px → カード `px-3` → 295px。
    固定分は gap-2×4 = 32 + 試合数 14 + 支払/名簿 112 = 158px。名前 div に残る 137px のうち
    編集(20)+削除(20)+gap(16) = 56px を除くと名前テキストは約 81px。ここへ固定幅バッジ
    48px + gap 8px を足すと名前が潰れて `…` だけになる。
  - 2 行目なら幅制約が無くなるため、ラベル文字数（`閲覧中` / `未閲覧` / `N分前`）に
    関係なく固定幅・切り詰めが不要になる。
  ```tsx
  <div key={player.id} className="bg-card border border-border rounded-xl px-3 py-2 shadow-sm">
    <div className="flex items-center gap-2">{/* 既存の 1 行目をそのまま移動 */}</div>
    {isAdmin && (
      <div className={`mt-0.5 flex items-center gap-1 text-[10px] leading-tight ${tone色}`}>
        <Clock className="w-3 h-3 shrink-0" aria-hidden />
        <span title={絶対時刻}>{view.label}</span>
      </div>
    )}
  </div>
  ```
  - 2 行目は幅に余裕があるためラベルが切れず、1 行目の要素構成は不変なのでレイアウトシフトも
    起きない（`docs/plans/2026-03-16-fix-layout-shift.md` の方針を満たす）。
  - `title` 属性に絶対時刻（既存 `formatTime` の `HH:MM`）を入れる（PC でのホバー補助）。
  - 管理者のみカードが 1 行分（約 14px）高くなる。可読性を優先したトレードオフ。
  - 突き合わせは `lastSeen[player.name]`。名前変更時は `sessionMutations.updatePlayer` が
    `lastSeen` を書き換えないため旧名エントリが孤立するが、**表示が `未閲覧` に戻るだけ**の
    軽微な劣化として許容（次のハートビートで新名エントリが作られる）。

## 変更対象ファイル

| ファイル | 変更内容 |
|---|---|
| `src/types/session.ts` | `Session.lastSeen` 追加 |
| `src/services/sessionService.ts` | `docToSession` 拡張 + `writeLastSeen` 新規 |
| `src/stores/presenceStore.ts` | `lastSeen` state / `setPresenceSnapshot` / `clear` 拡張 |
| `src/hooks/useFirebaseSync.ts` | snapshot から `lastSeen` を流す |
| `src/hooks/useLastSeen.ts` | **新規** ハートビート（全ページ） |
| `src/components/FirebaseSyncMount.tsx` | `useLastSeen()` 呼び出し |
| `src/lib/lastSeen.ts` | **新規** 表示整形 |
| `src/lib/lastSeen.test.ts` | **新規** ユニットテスト |
| `src/pages/PlayerSelect.tsx` | 管理者のみバッジ表示 + 30 秒 tick |

## 書き込みコスト

- 1 write / 60 秒 / アクティブユーザー（可視タブのみ）。5 人同時で 5 writes/min。
- 各 write は他ユーザーへ onSnapshot として届くが、`updatedAt` 非更新のため
  `shouldApplyRemoteData` で早期 return し、`applyRemoteData` の重い処理は走らない
  （`presence` と同じ経路。実装時に `src/lib/syncUtils.ts` で再確認）。
- 3 時間セッション・5 人で約 900 writes / 4,500 reads。無料枠内。

## 検証手順

1. `npm run build` / `npm run lint` / `npm run test:run` をすべて通す（CLAUDE.md 必須）。
2. 手動確認（2 プロファイルで同一セッション）:
   - (a) 管理者で `/players` → 自分は `閲覧中`、未入室の登録者は `未閲覧`
   - (b) B が入室 → 90 秒以内に B が `閲覧中` になる
   - (c) B がタブを裏に → 90 秒後に `1分前`、以降 `N分前` が増える
   - (d) 15 分放置で `text-amber-600` に変わる
   - (e) 一般ユーザ（非管理者）では列自体が出ない
   - (f) `/main` 以外（`/history` など）を開いている B も `閲覧中` になる
   - (g) 名前に `.` を含むユーザで正しく表示される（`FieldPath` 検証）
3. DevTools > Application > LocalStorage に `lastSeen` が保存されていないこと。
4. Firestore コンソールで `lastSeen` 書き込み後も `updatedAt` が変わらないこと。

## 非対象

- 「N分放置している人へ通知」等のプッシュ連携
- 参加者管理ページ以外への表示（MainPage は既存 `presence` バッジで足りる）
- 名前変更時の `lastSeen` キー移行（上記トレードオフとして許容）
- `lastSeen` のサーバー側プルーニング
