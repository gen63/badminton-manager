# 練習終了後にセッションから自動退出する

## Context

`2026-08-18-session-list-hide-after-last-match.md` でセッション一覧の非表示条件を
「最後の試合終了から30分」に変えた。その続きとして、**一覧から消えるのと同じ条件で、
セッションに入っているメンバーを退出させる**（セッション選択画面へ戻す）。

一覧から消えるだけだと、アプリを開きっぱなしの人が終わった練習の画面に留まり続ける。
退出させれば次にアプリを見たときにセッション選択画面から始まる。

## 判定

**一覧の非表示条件（`isSessionVisible`）と完全に同条件**を使う。ただし
**試合開始済みのセッションだけ**を対象にする。

```
shouldAutoExitSession(session, now):
  firstMatchStartedAt が無い（試合未開始） → false（退出しない）
  それ以外                                → !isSessionVisible(session, now)
```

試合未開始を対象外にするのは、`isSessionVisible` の「開始90分前まで非表示」ルールが
*一覧に出さない* だけのルールだから（`2026-05-19-hide-sessions-until-90min-before-start.md`
に「一覧に出ないだけ（直接URLでは参加可能）」と明記）。これを退出条件にそのまま使うと、
**練習開始2時間前にセッションを作った作成者が即座に追い出される**。

結果として実際に効くのは「最後の試合終了から30分」「コート進行中なら継続」
「12時間で絶対に打ち切り」の3つ。

## 実装方針

### サーバー不在なので「各端末が自分で出る」

Cloud Functions 等のサーバー側スケジューラは無い（GitHub Pages の静的配信 + Firestore のみ）
ため、「全員を一斉に蹴る」処理は書けない。**各端末が同じ判定を自分で行い、自分から
離脱する**ことで、結果的に全メンバーが退出した状態になる。

`participants` からは既存の `leaveSession()` で自分を消す。アプリを閉じている端末の分が
残るのは既存の離脱経路（`SessionCreate` / `SessionJoinPage` のセッション切替）と同じ挙動。

### tick が要る

`onSnapshot` のコールバックは Firestore に更新が来たときしか走らず、練習終了後は無操作で
更新が止まるため、時間経過だけでは発火しない。`SessionSelectPage` の一覧フィルタと同じ
**60秒間隔の tick** を持つ。マウント直後にも1度判定する（PWA 再起動や、終了済み
セッションへの URL 直アクセスで60秒待たされないように）。

### 退出処理は既存の強制退出と同じ形

`useFirebaseSync` には既に強制退出が2経路ある。同じ `clearSession()` +
`navigate('/', { state: { notice } })` の形に揃える。

| 経路 | 場所 |
|---|---|
| セッション削除 | `useFirebaseSync.ts:132` |
| TTL（30日）切れ | `useFirebaseSync.ts:180` |
| **練習終了（本 plan）** | `useSessionAutoExit.ts` |

## 変更内容

### 1. `src/lib/sessionArchive.ts`

`shouldAutoExitSession(session, now)` を追加。`isSessionVisible` をそのまま呼び、
試合未開始だけ除外する薄いラッパー（判定ロジックを二重に持たない）。

### 2. `src/hooks/useSessionAutoExit.ts`（新規）

- 60秒 tick（`AUTO_EXIT_CHECK_INTERVAL_MS`）+ マウント直後の即時判定。
- 判定材料はローカルの `gameStore` から算出する（`computeFirstMatchStartedAt` /
  `computeLastMatchFinishedAt` / `computeHasActiveCourt`）。`Session` の派生フィールドは
  一覧用なので使わない。
- 退出時: `leaveSession` + `clearPresence`（fire-and-forget）→ `clearSession()` →
  `navigate('/', { state: { notice: { type: 'warning', ... } } })`。
- **dev モードでは無効**（一覧の非表示フィルタ自体を dev モードがバイパスしているため）。
- `isGameStateLoaded` が true になるまで判定しない（初回受信前は `matchHistory` が空）。
- `exitedRef` で 1 セッションにつき 1 回だけ退出（interval の多重発火防止）。

### 3. `src/components/FirebaseSyncMount.tsx`

`useSessionAutoExit()` を追加。会計ページ等どの画面にいても発火させる必要があるため、
`useFirebaseSync` / `useLastSeen` と同じ App level に置く。

### 4. テスト

- `src/lib/sessionArchive.test.ts` — `shouldAutoExitSession` の境界と、
  「試合開始済みなら `isSessionVisible` と常に裏返し」の関係。
- `src/hooks/useSessionAutoExit.test.ts`（新規）— 31分経過で即退出 / 29分では退出せず
  次の tick で退出 / 進行中コートでは退出しない / 試合0件では退出しない / dev モードでは
  退出しない / 初回受信前は判定しない / 退出は1回だけ。

## 既知のトレードオフ

**会計・アップロード作業が巻き込まれる。** 最後の試合終了から30分は会計入力や GAS
アップロードの最中でありうるが、`AccountingPage` も同じセッション配下なので入力途中で
`/` に飛ばされる。一覧非表示と同条件にすることを優先した結果として受け入れる
（除外を入れる場合は別 plan）。

退出後はセッションが一覧から消えているため、戻るには URL 直アクセスか dev モードが必要。

## 検証

```bash
npm run build && npm run lint && npm run test:run
```

手動確認（dev モードを切る）:
1. 試合を1回終わらせ、30分放置 → セッション選択画面に戻り、警告バナーが出る。
2. コートに試合を配置したまま30分超 → 退出しない。
3. 練習開始2時間前に作成したセッションに入っていても退出しない。
4. 退出後、`participants` から自分が消えていること。
5. dev モードでは退出しないこと。
