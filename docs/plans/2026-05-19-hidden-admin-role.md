# 2026-05-19 裏管理ロール（観覧専用）

## 背景・課題

運営の便宜上、`participants` / `registeredPlayers` / `presence` の
どれにも名前を残さずに、作成者と同等の権限で操作だけ行いたい立場
（"裏管理"）が欲しい。具体的には:

- セッション参加者リスト（SessionJoinPage の名前選択グリッド、
  入室済みアコーディオン、MainPage のプレイヤー一覧/コート、
  会計画面の支払者一覧 等）に名前を残さない。
- PresenceIndicator の "X さんが操作中" / "閲覧中" バッジに出ない。
- それでも `isAdmin()` / `isCreator()` 相当の権限で書き込みできる。

## ユーザー側の意思決定（事前に確認済）

- **識別方法**: dev モード時のみ入室画面に「裏管理として入室」
  選択肢が出る（既存の dev モード = `localStorage['dev-mode']==='1'`）。
- **参加形態**: 完全に非参加（観覧専用）。`participants` /
  `registeredPlayers` / `gameState.players` のいずれにも追加しない。

## 方針サマリ

`currentUser = null` の状態のままで MainPage に遷移できる経路を
SessionJoinPage に追加するだけで、ほぼ全ての要件が満たせる。

- 既存の `sessionStore.isAdmin()` / `isCreator()` は `isDevMode()` の時
  常に true を返すため、dev モード ON のクライアントは追加実装なしで
  作成者相当の権限を持つ。
- `usePresence(sessionId, currentUser)` は `currentUser` が
  falsy のとき完全に no-op になる実装なので、`currentUser = null` の
  ままなら presence は一切書かれない。
- `joinSession()` を呼ばないため `participants` /
  `registeredPlayers` / `gameState.players` のどこにも名前が
  載らない。PresenceIndicator / 各種リストの表示は副作用なしで成立。
- `updateInformation()` 等で `updatedBy` に渡される `currentUser` も
  null なので、`session.information.updatedBy` にも名前が残らない。
  MainPage は `{session?.information?.updatedBy && ...}` のガードで
  描画しないため副作用なし。

## 実装範囲（最小）

### 1. `src/pages/SessionJoinPage.tsx`

- `useDevMode()` をインポート。
- dev モード ON の時だけ「裏管理として入室（観覧専用）」ボタンを
  名前選択カードの下、もしくは「リストにない名前で参加」リンクの近くに
  控えめに表示する（誤タップ防止のため、確認ダイアログ無しでも目立たない
  ボタンスタイルにする）。
- ボタンの handler `handleEnterAsHiddenAdmin`:
  1. `joinSession()` は **呼ばない**。
  2. 既存 `handleJoin` と同様の前処理を行う:
     - 別セッションに居る場合は前セッションの `leaveSession` /
       `clearPresence`（前回の currentUser が分かっている場合のみ）。
     - `usePlayerStore` / `useGameStore` / `useReservationStore` /
       `useAccountingStore` / `useUndoStore` のクリア
       （別オンラインセッションへの切替時のみ。既存 `handleJoin`
       と同じ判定ロジックを流用）。
  3. `useSessionStore.getState().initialize(session)` を呼んで session を
     セット。`initialize` は `currentUser` を `session.createdBy` で
     上書きするため、続けて
     `useSessionStore.getState().setCurrentUser('')` で空文字列に戻す。
     - **注**: `setCurrentUser` は `(name: string) => void` のため
       null を渡せない。空文字列 `''` であれば既存の falsy チェック
       （`if (!currentUser)` 等）はすべて通過するので presence /
       参加者扱いから外れる。
     - 補足: 永続化されているのは `currentUser` のみ。空文字列なら
       次回起動時の自動選択 (`registeredPlayers?.includes(persistedUser)`)
       も false で誤マッチしない。
  4. `useSyncStatusStore.setGameStateLoaded(false)` → poll → `/main`
     遷移（既存 `handleJoin` 末尾のロジックと同じ）。

### 2. 動作確認用に既存実装を変えるか

基本的に追加実装のみで完結する。ただし以下は念のため見直す。

- `sessionStore.isAdmin()` / `isCreator()` の `if (!currentUser) return false;`
  ガードを `if (!currentUser) return isDevMode();` 風に書き換える必要は
  **無い**（既に `if (isDevMode()) return true;` が前段にある）。
- `MainPage` の `currentUser` null 互換コードはすでに揃っている:
  - `usePresence(session?.id ?? null, currentUser)`: hook 側で no-op。
  - `updatePaymentBadge` の effect: `if (!session || !currentUser)` で early return。
  - 周知事項未読バッジ: `currentUser` ガード済。
  - 運営タスク表示: `{currentUser && ...}` ガード済。
  - PresenceIndicator: 自分を除外する条件 `name === currentUser`
    だけが影響を受けるが、そもそも自分のエントリが presence に
    書かれないため問題なし。

## 影響範囲・リスク

- **dev モードを ON にしている全クライアントが対象**。これまでも dev モードは
  `isAdmin()/isCreator()` を常に true 化していたため、権限面での差分は
  「観覧専用入室ボタンが追加される」だけ。
- **`currentUser=''` の運用**: 既存コードは null チェックではなく truthy
  チェック (`if (!currentUser)` / `{currentUser && ...}`) のみ。空文字列も
  null と同じく falsy なので新しい分岐は不要。ただし `===` の文字列比較で
  `currentUser === '何か'` を期待するパスがあると常に false になる。
  これは元々「自分」を識別する用途なので、観覧専用ユーザに対しては正しい挙動。
- **再入室時の挙動**: 観覧専用入室後にブラウザをリロードすると、
  session は persist されていないので SessionSelectPage に戻る。currentUser
  は空文字列で persist される。再度セッションに入る際は SessionJoinPage で
  通常通り名前選択するか、観覧専用ボタンを再度押す。
- **PWA バッジ**: 観覧専用ユーザの `currentUser` が無いため、支払い予定額
  バッジは表示されない（既存の `if (!session || !currentUser)` パス）。
  仕様通り。
- **バグ報告フォーム**: 既存実装は `currentUser ?? null` で空文字列も
  そのまま送信される。プライバシー観点では識別子が空のほうが望ましいので、
  Discord 送信側の `currentUser` が空文字列 / null の扱いだけ後で要確認
  （今回のスコープでは触らない）。

## テスト計画

1. dev モード OFF: 観覧専用ボタンが出ないこと。
2. dev モード ON で観覧専用ボタンから入室:
   - `participants` / `registeredPlayers` / `gameState.players` の
     どれにも新名が増えないこと（Firestore 直接確認 or 別ユーザーから観察）。
   - PresenceIndicator に自分が出ないこと（別タブから観察）。
   - 連続モードトグル・周知事項編集・config 編集等の管理者操作が
     `isAdmin()` 経由で許可されること。
3. 観覧専用入室中に周知事項を編集 → 別ユーザー側で `更新: <名前>` が
   表示されないこと（`updatedBy` が空のため）。
4. 観覧専用入室後にリロード → SessionSelectPage に戻り、再度入室画面に
   進んだとき名前が自動選択されないこと。

## 非対応 (Out of Scope)

- 認証付きの本格的な管理者ロール（Firebase Auth + Security Rules）。
  CLAUDE.md の信頼モデルに従い、今回もクライアント側の dev モードに依存する。
- 観覧専用ユーザの行動ログ（誰が裏で操作したか）。本機能の趣旨に反する
  ため意図的に記録しない。
