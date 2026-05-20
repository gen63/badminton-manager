# タブバー4タブ化 + 設定をヘッダーへ移動

> **注記 (2026-05-20)**: 本 plan の「ステップ 4: PlayerSelect.tsx をデュアルモード対応」
> のうち **セットアップモード分岐は廃止された**。Phase 4 で Firebase 必須化された後、
> `/players` は正規導線から session 有り状態でのみ到達するため、Setup Mode は
> 到達不能なデッドコードとなっていた。詳細は
> `docs/plans/2026-05-20-remove-playerselect-setup-mode.md` を参照。
> 現在の PlayerSelect は session ガード付きの単一モード（旧タブモード）のみ。

## Context
現在のBottomNavは3タブ（予約/履歴/設定）。参加者管理と会計管理へのアクセスが深い（設定経由）ため、タブバーに昇格させてワンタップでアクセス可能にする。設定は使用頻度が低いためヘッダーのギアアイコンに移動。

## 新しいタブ構成
| タブ | アイコン | 遷移先 |
|------|---------|--------|
| 予約 | CalendarCheck | MainPage（モーダル表示）/ 他ページからは`/main`へナビゲート |
| 参加者 | Users | `/players` |
| 会計 | DollarSign | `/accounting` |
| 履歴 | History | `/history` |

設定 → MainPageヘッダー右端にギアアイコン（Undo/Redoの横）

## 実装ステップ

### 1. BottomNav.tsx を4タブ化
`src/components/BottomNav.tsx`
- `activeTab` propを追加（`'reservation' | 'players' | 'accounting' | 'history'`）
- Settings タブ削除 → Users（参加者）、DollarSign（会計）タブ追加
- アクティブタブ: `text-blue-600`、非アクティブ: `text-gray-400`（現在は全てmuted）
- 予約タブ: MainPageでは`onReservationOpen`コールバック、他ページでは`/main`へナビゲート
- 参加者/会計/履歴タブ: `navigate()`で遷移
- reservationCountはBottomNav内で`useReservationStore`から直接取得（props簡素化）

### 2. MainPage.tsx にSettingsギアアイコン追加
`src/pages/MainPage.tsx`
- ヘッダー右側（Undo/Redoボタンの横）にSettingsアイコンボタン追加
- クリックで`/settings`へナビゲート
- BottomNavに`activeTab="reservation"`を渡す

### 3. HistoryPage.tsx にBottomNav追加
`src/pages/HistoryPage.tsx`
- BottomNavをページ下部に追加、`activeTab="history"`
- 既存の戻るボタン（ArrowLeft）はそのまま残す
- コンテンツ下部にBottomNav分のパディング追加

### 4. PlayerSelect.tsx をデュアルモード対応
`src/pages/PlayerSelect.tsx`
- `useSessionStore`でセッション存在を検出
- **セッション有り（タブモード）**: BottomNav表示（`activeTab="players"`）、「完了→」ボタン非表示、下部パディング追加
- **セッション無し（セットアップモード）**: 現在の動作を維持（「完了→」ボタンあり、BottomNavなし）

### 5. AccountingPage.tsx にBottomNav追加
`src/pages/AccountingPage.tsx`
- BottomNav追加、`activeTab="accounting"`
- ヘッダーの戻るボタンの遷移先を`/settings`→`/main`に変更
- 下部パディング確認（既存`pb-20`で足りるか検証）

### 6. SettingsPage.tsx から重複リンク削除
`src/pages/SettingsPage.tsx`
- 「会計」「参加者を管理」のナビゲーションボタンを削除（タブから直接アクセス可能になるため）
- SettingsPage自体にはBottomNavを追加しない（ギアアイコンからのアクセス）

## 変更ファイル一覧
| ファイル | 変更規模 |
|---------|---------|
| `src/components/BottomNav.tsx` | 大（4タブ化、activeTab対応） |
| `src/pages/MainPage.tsx` | 小（Settingsギアアイコン追加） |
| `src/pages/HistoryPage.tsx` | 中（BottomNav追加） |
| `src/pages/PlayerSelect.tsx` | 中（デュアルモード、BottomNav追加） |
| `src/pages/AccountingPage.tsx` | 中（BottomNav追加、戻るボタン変更） |
| `src/pages/SettingsPage.tsx` | 小（重複リンク削除） |

ルーティング（App.tsx）の変更は不要。

## 検証方法
1. `npm run lint` でエラーなし
2. `npm run build` でビルド成功
3. 動作確認:
   - 各タブ間の遷移が正しく動作する
   - アクティブタブのハイライトが正しい
   - MainPageのギアアイコンから設定画面に遷移できる
   - セッション未開始時のPlayerSelectは従来通りセットアップフロー
   - 予約バッジが全ページで表示される
