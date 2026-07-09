# デフォルト周知事項（デフォルトアナウンス）機能

日付: 2026-07-09

## 背景・目的

周知事項（`session.information`、MainPage の i アイコンから閲覧・既読管理される
テキスト）は現在セッションごとに手入力する必要がある。毎回同じ注意事項
（体育館ルール・会費案内など）を貼り直す手間を無くすため、**セッション横断の
「デフォルト周知事項」** を設定できるようにする。

- デフォルト周知事項は **セッション一覧ページ（SessionSelectPage）の最上部**から
  管理者モード（dev モード）で編集できる。
- 設定しておくと、**新規セッション作成時に自動で `session.information` に
  セットされる**。メンバーには通常の周知事項と同様に i アイコン＋未読バッジで
  届く。
- 既存セッションの周知事項には影響しない（作成時にコピーする方式）。

## データ設計

新しい Firestore ドキュメント **`appConfig/global`** を追加する。

```ts
// appConfig/global
{
  defaultAnnouncement: {
    text: string;       // デフォルト周知事項（空文字 = 未設定）
    updatedAt: number;  // 更新時刻（ms）
    updatedBy?: string; // 更新者名（currentUser があるときのみ）
  }
}
```

- セッションに紐付かないグローバル設定なので `sessions/{id}` の外に置く。
- 「作成時にコピー」方式を採用する。参照方式（セッションが常に appConfig を
  参照）にしないのは、①既存の information 表示・既読管理ロジックを一切変えずに
  済む、②セッションごとに後から個別編集できる、ため。

### ⚠️ Firestore Security Rules（リポジトリ外・要手動対応）

Rules は Firebase console 管理のため、デプロイ前に `appConfig/{doc}` への
read/write 許可を追加する必要がある（現状 `sessions` のみ許可の場合、
読み書きが permission-denied になる）。

- 読み取り失敗時はセッション作成を止めず「デフォルト無し」で続行する
  （下記 fail-safe）。

## 変更箇所

### 1. `src/services/appConfigService.ts`（新規）

- `getDefaultAnnouncement(): Promise<DefaultAnnouncement | null>`
  — 編集 UI 用。失敗は throw（UI でエラー表示）。
- `setDefaultAnnouncement(text: string, updatedBy?: string): Promise<void>`
  — trim 済みテキストを `setDoc(..., { merge: true })` で保存。空文字で「未設定」。
- `fetchDefaultAnnouncementTextSafe(): Promise<string>`
  — セッション作成経路用。失敗時は warn して `''` を返す fail-safe。
    （デフォルト周知事項が読めないことを理由にセッション作成を失敗させない）

### 2. `src/pages/SessionSelectPage.tsx`

- dev モード限定で、セッション一覧の**上**に「デフォルト周知事項」カードを表示。
  - 1 行目: ラベル + 設定済みなら本文の最初の 1 行をプレビュー（truncate）。
  - 右端に鉛筆ボタン → 編集モーダル（既存のセッション情報編集モーダルと同型）。
- モーダル: textarea + 保存/キャンセル。保存で `setDefaultAnnouncement`。
  「新規セッション作成時に周知事項として自動設定される」旨の説明を添える。
- マウント時（dev モード & Firebase 設定済みのときのみ）に
  `getDefaultAnnouncement` で現在値を取得。

### 3. `src/pages/SessionCreate.tsx`（手動作成）

- `handleCreate` 内で `fetchDefaultAnnouncementTextSafe()` を呼び、テキストが
  あれば `createSession` の payload に
  `information: { text, updatedAt: now, readBy: [] }` を含める。
- ローカル `initializeSession` にも同じ information を渡し、作成直後から
  i アイコンに反映されるようにする。
- `readBy` は空配列（作成者もデフォルト文面の著者ではないため未読扱い）。

### 4. `scripts/auto-create-session.ts`（自動作成・GitHub Actions）

- `processEvents` の冒頭で `appConfig/global` を 1 回読み、
  `buildSessionData(event, memberMap, targetDate, defaultAnnouncementText?)` に
  渡す（読み取り失敗は warn + デフォルト無しで続行）。
- `buildSessionData` はテキストが非空のとき
  `information: { text, updatedAt: Date.now(), readBy: [] }` を含める。

### 5. テスト

- `scripts/auto-create-session.test.ts` に buildSessionData の
  information 有り/無しのケースを追加。

## 影響しない範囲

- MainPage の i アイコン・未読バッジ・既読化は既存の `session.information`
  ロジックのままで変更不要（コピー方式のため）。
- 既存セッションのデータ・SessionSelectPage の個別セッション編集モーダルは
  変更しない。
