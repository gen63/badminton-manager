# ローカルストレージ最小化 (Phase B / Phase C)

作成日: 2026-05-06
対応ブランチ: `claude/fix-doubles-player-display-mEvx6`

## 背景

[Phase A](./2026-05-06-settings-persist-narrowing.md) で `settingsStore` の
Firestore 同期対象を persist から外したのに続き、ユーザー方針
「**ローカルの情報は限りなく使わない・残さない**」に沿ってさらに削減する。

棚卸し結果:

| 永続化先 | 中身 | Firestore に同じものある？ |
|---|---|---|
| `badminton-settings` (settingsStore) | Phase A 後は端末ローカル設定のみ | (該当なし) ✓ |
| `badminton-session` (sessionStore) | session + currentUser | session 全体は Firestore 由来 ❌ |
| `accounting-storage` (accountingStore) | records (GAS アップロード成功キャッシュ) | GAS シートが永続先 △ |

## Phase B: `sessionStore` を `currentUser` だけ persist にする

### 変更

```ts
persist(
  ...,
  {
    name: 'badminton-session',
    version: 1,
    migrate: (persisted, version) => {
      if (version < 1 && persisted && typeof persisted === 'object') {
        const obj = persisted as Record<string, unknown>;
        return { currentUser: obj.currentUser ?? null };
      }
      return persisted;
    },
    partialize: (state) => ({
      currentUser: state.currentUser,
    }),
  },
)
```

`session` (id, config, accounting, ...) は persist しない。`currentUser` (端末で
誰として参加しているか) だけ残す。`migrate` で旧 version の `session` を剥がす。

### UX 影響

- リロード時 `session = null`。
- 各ページの `if (!session) navigate('/')` ガードで SessionSelectPage に戻る
  （MainPage / HistoryPage / SettingsPage / ReservationPage / AccountingPage で
  既に実装済み）。
- `useFirebaseSync` は `session.id` の変化を購読しているので、SessionSelectPage
  で別セッションを選んで SessionJoinPage 経由で join すれば購読開始される
  （既存挙動）。

### `currentUser` プレセレクト (UX 補填)

`SessionJoinPage` 初回読み込み時、`useSessionStore.getState().currentUser` が
セッションの `registeredPlayers` に含まれていれば `selectedName` を自動で
入れる。ユーザーは「OK」を押すだけで再入室できる（タップ数 1 増加で済む）。

### セッション URL ブックマーク経路

`/session/:sessionId` URL は元々 SessionJoinPage を呼ぶので影響なし。
`currentUser` プレセレクトと組み合わさって、**ブックマークから 1 タップで
復帰** できる。

### URL バー直書き `/main` 経路

session=null → MainPage の `if (!session) navigate('/')` で `/` に戻る。
ユーザーは SessionSelectPage で session を選び直す。これは方針通り。

## Phase C: `accountingStore` の persist 撤廃

### 変更

`accountingStore.ts` の `persist()` ラッパーを除去。`records[]` は
**メモリ内のみ**。`legacyStorageMigration` で `accounting-storage` キーを
1 度だけ掃除する。

### UX 影響

`AccountingPage` の自動入力ロジック:

| 項目 | 旧 | 新 |
|------|---|----|
| 男女料金 | 同じ練習種別の直近レコード優先、なければ標準値 | 常に標準値 |
| シャトル単価 | 直近レコード | (デフォルト 480 円) |
| 体育館代 | 同じ体育館の直近レコード優先、なければ固定値 | 常に固定値 |

ユーザーは数フィールドを毎回手入力する必要があるが、方針との整合性を
優先する。`records.length === 0` のフォールバックパスは元々あるので
コード自体の変更は最小（`persist` ラッパー除去のみ）。

## `legacyStorageMigration` v2

`badminton-legacy-cleanup-v1` フラグを `v2` に上げて、既存ユーザーの
`accounting-storage` を 1 度だけ掃除する。

```ts
const FLAG_KEY = 'badminton-legacy-cleanup-v2';
// ... v1 で消したキー ...
localStorage.removeItem('accounting-storage');
localStorage.removeItem('badminton-legacy-cleanup-v1');  // v1 フラグも掃除
localStorage.setItem(FLAG_KEY, '1');
```

## Phase B/C 後のローカルストレージ全量

| key | 残す理由 |
|---|---|
| `badminton-settings` | 端末ローカル設定（GAS URL / 配置クセ等） |
| `badminton-session` | `currentUser` (= 自分の名前) のみ |
| `dev-mode` | 開発モードフラグ (`?dev=1` で有効化) |
| `accounting-calc-last-input` | スタンドアロン会計計算ツールの入力復元 |
| `badminton-last-error` | クラッシュ時のデバッグログ (ErrorBoundary 書き出し) |
| `badminton-legacy-cleanup-v2` | 1 度だけ走る掃除フラグ |

Firestore SDK が IndexedDB に作る読みキャッシュは別レイヤー（SDK 内部で管理）。

## 動作確認

- `npm run build` / `npm run lint` / `npm run test:run` がすべて通る
- `sessionStore.test.ts`: persist 後に `session` が含まれず `currentUser` のみが
  書かれること、migrate で旧 `session` が剥がれることを 3 ケースで検証
- `legacyStorageMigration.test.ts`: 新規ファイル。v1/v2 各キーの掃除と冪等性、
  現役 persist キーを触らないことを 7 ケースで検証

## 非対象

- `accounting-calc-last-input` / `badminton-last-error` / `dev-mode`:
  各々端末固有で Firestore に同等のものは無い。残す。
- `currentUser` の persist: 完全に消すと毎回名前選択になる UX 劣化が大きい。
  名前文字列だけなので方針との緊張は許容範囲。
- Firestore SDK の IndexedDB cache: SDK 内部の管理レイヤーで、書き込みの
  ソース・オブ・トゥルースではないため対象外。
