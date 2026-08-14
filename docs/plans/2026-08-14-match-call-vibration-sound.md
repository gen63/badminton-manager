# 呼び出し通知に音・振動を追加

## 背景

「まもなく出番です」の事前呼び出し通知（`2026-08-13-next-match-call-notification.md`）は
Browser Notification + グローバルトーストで出しているが、体育館で端末を伏せている・
別のことをしているメンバーには気づかれにくい。音と振動を足して気づきやすくする。

## 調査で判明した既存バグ

`src/lib/notifications.ts` はページ側の `new Notification()` を使っているが、
**Chrome on Android ではこのコンストラクタが `Illegal constructor` を throw する**
（`ServiceWorkerRegistration.showNotification()` を使えという仕様）。

その結果、Android 端末では：

- 呼び出し通知も強制休憩通知も一切表示されない
- `MainPage.tsx` では `notifyNextMatchSoon()` がトーストの `show()` より先に呼ばれて
  いるため、throw でトーストまで道連れになる
- `calledForNextMatchRef` も立たないので 10 秒ごとに再試行され続ける

今回の実装で併せて塞ぐ。

## プラットフォーム別の実現可否

| 環境 | OS通知 | `navigator.vibrate` | アプリ内音声 |
|---|---|---|---|
| Android Chrome（タブ） | ○ ※SW経由必須 | ○ | ○ |
| Android（PWA） | ○ | ○ | ○ |
| iOS Safari（タブ） | ✕ API 自体が無い | ✕ 未実装 | ○ |
| iOS（ホーム画面 PWA, 16.4+） | ○ | ✕ 未実装 | ○ |

- **音はどの環境でも鳴らせる**。ページ内で完結するので PWA/タブの区別が要らない。
- 振動は iOS では PWA にしても不可能（`navigator.vibrate` 未実装）。
- したがって環境判定（`display-mode: standalone` 等）は不要で、feature detection で足りる。

### iOS の消音スイッチ

`navigator.audioSession` で消音スイッチを無視することは技術的には可能だが、
**採用しない**。消音にしている人に音を出すのは筋が通らない。消音スイッチ ON の
iOS ユーザーはトースト（と PWA なら OS 通知）のみで受け取る。

## スコープ外

- **バックグラウンド通知（Web Push + FCM）はやらない。** 判定は `MainPage` の
  `setInterval` なので、アプリを開いている間しか発火しない。ネイティブでない以上
  そこは諦める、という判断。
- **判定ロジックの常設化もやらない。** 履歴・会計タブを開いている間は通知が
  発火しない（`useEffect` が unmount される）が、現状維持とする。

## 設計

### 1. 通知の送出を Service Worker 経由へ（`src/lib/notifications.ts`）

`navigator.serviceWorker.getRegistration()` で登録済み SW を取得し、
`registration.showNotification()` で表示する。取れない・active でない場合のみ
`new Notification()` にフォールバックし、それも throw したら握り潰す。

`navigator.serviceWorker.ready` は SW 未登録だと永久に resolve しないため使わない。
SW は `PWAPrompt.tsx` の `useRegisterSW` が登録済み。

呼び出し側のシグネチャは `void` のまま（内部で fire-and-forget）。通知の失敗が
呼び出し側に伝播しないことを保証する。

呼び出し通知には `vibrate: [200, 100, 200]` を付ける（Android の OS 通知用。
他環境では無視される）。`NotificationOptions` の TS 型に `vibrate` が無いため
ローカルの拡張型を定義する。

### 2. 音・振動の発火（新規 `src/lib/matchCallAlert.ts`）

- `unlockMatchCallAudio()` — ユーザー操作時に `AudioContext` を生成/`resume()`。
  モジュールシングルトンで保持。
- `playMatchCallChime()` — WebAudio の `OscillatorNode` で短いビープ 2 音
  （880Hz → 1175Hz、各 0.15 秒）。音声ファイルを追加しないのでオフラインでも確実。
  クリックノイズを避けるため gain をランプさせる。
- `vibrateMatchCall()` — `navigator.vibrate?.([200, 100, 200])`。
- `fireMatchCallAlert()` — 設定 ON のときに上記 2 つを実行する単一の入口。

### 3. 設定（`src/stores/settingsStore.ts`）

`matchCallAlert: boolean`（デフォルト `true`）を追加し、`partialize` に含めて
端末ローカルに persist する。**Firestore 同期はしない** — 鳴らしたい人と
鳴らしたくない人が同一セッションに混在するのが普通のため。

新規キーなので旧 localStorage には存在せず、デフォルト値が入る。version 5 への
bump と migrate は不要。

デフォルト ON の根拠: `shouldCallNextMatch()` は `myPlayerId` が `certainIds` に
含まれるときだけ true を返すので、鳴るのは次に呼ばれる最大 4 人の端末だけ。
体育館で一斉に鳴ることはない。

### 4. UI（`src/pages/MainPage.tsx`）

ヘッダー右グループ（undo/redo の隣、管理者向け歯車の**手前**）にベル／ベル斜線の
トグルアイコンを追加。**全メンバーに表示する**。

設定画面（`/settings`）には置かない。`MainPage.tsx` の歯車が `isAdmin()` で
囲まれており、`SettingsPage.tsx` 自体も非管理者を `/main` へリダイレクトするため、
**一般メンバーには設定画面が見えない**。呼ばれるのを待つ側こそが主な対象なので、
そこに置いたら意味がない。

トグルの副産物:

- タップがそのまま `AudioContext` の unlock になる
- ON にした瞬間にチャイムを 1 度鳴らせば、別途「テスト再生」ボタンが不要
- アイコンの見た目が現在の状態表示を兼ねる
- 音と振動が 1 トグルにまとまり、iOS で「振動 ON にしたのに鳴らない」が起きない

### 5. 発火順序の修正（`src/pages/MainPage.tsx`）

呼び出し成立時の順序を「トースト → OS通知 → 音・振動」に変更する。
トーストを最初に出すことで、通知系が失敗しても画面表示だけは必ず残す。

## テスト

- `src/lib/matchCallAlert.test.ts` — 設定 OFF で何も起きない / ON で
  `navigator.vibrate` が呼ばれる / `vibrate` 未実装環境で throw しない /
  unlock 前でも throw しない。`AudioContext` は mock。
- `src/lib/notifications.test.ts` — SW 登録あり → `showNotification` が呼ばれる /
  SW 無し → コンストラクタにフォールバック / コンストラクタが throw しても
  呼び出し側に伝播しない / `permission !== 'granted'` で何もしない。
