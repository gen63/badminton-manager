# スプレッドシート読み込み機能 — 現状分析と改善プラン

## 現状サマリー

セッション作成画面からGoogle Sheets経由でメンバーを読み込む機能。
GAS Web Appを中継し、「当日参加者」シートからメンバー名とレーティングを取得する。

### 実装済みファイル

| ファイル | 役割 | 状態 |
|----------|------|------|
| `src/lib/sheetsMembers.ts` | GAS GETリクエスト＆パース | ✅ 実装済み |
| `src/pages/SessionCreate.tsx` | 読み込みUI（ボタン・ローディング・エラー） | ✅ 実装済み |
| `src/stores/settingsStore.ts` | GAS URL永続化 | ✅ 実装済み |
| `docs/gas-script.js` | GAS doGet() サンプル | ✅ 実装済み |

### 既存のデータフロー

```
SessionCreate画面
  ↓ ボタンタップ
fetchMembersFromSheets(gasWebAppUrl)
  ↓ GET
GAS Web App → doGet() → 「当日参加者」シート
  ↓ JSON: { status: 'ok', members: [{name, rating?}...] }
membersToText() → テキストエリアに反映
  ↓ セッション開始
addPlayers() → playerStore
```

---

## 課題と改善ポイント

### 課題1: GAS URL入力のUX

**現状:** GAS URL未設定時、SessionCreate画面内にURL入力欄が表示される。設定画面にもURL入力欄がある。

**問題点:**
- 初回ユーザーにとって、メンバー入力欄の中にURL設定があるのは分かりにくい
- URLを知らないユーザーには何を入れていいか不明
- 設定画面と二重管理

**改善案:**
- GAS URL未設定時: 「Sheetsから読み込み」ボタン → タップで設定画面へ誘導、または inline で URL 入力を促すツールチップ表示
- 現状の方式（inline入力）でも実用上は問題ないが、ラベルを改善して分かりやすくする

### 課題2: 読み込み時の上書きvs追加

**現状:** 読み込むとテキストエリアの既存内容が上書きされる。

**問題点:**
- 手動で数人追加した後にSheets読み込みすると、手動入力分が消える
- 逆に、Sheets読み込み後に追加したい人がいる場合は手動で追記可能（こちらは問題なし）

**改善案:**
- テキストエリアが空でない場合、「上書きしますか？」の確認を入れる
- または追加モード（既存の末尾にappend）を選択可能にする

### 課題3: 前回読み込みメンバーのキャッシュ

**現状:** 毎回GASにリクエストが必要。オフライン時は読み込み不可。

**問題点:**
- 練習会場がWi-Fi不安定な場合、読み込み失敗する可能性
- 前回と同じメンバーで練習する場合でも毎回読み込みが必要

**改善案:**
- 最後に読み込んだメンバーリストを `settingsStore` にキャッシュ
- オフライン時はキャッシュから復元可能にする
- 「前回のメンバーを使う」ボタンを追加

### 課題4: 読み込み結果のフィードバック

**現状:** 成功時はテキストエリアに反映されるだけ。エラー時は赤テキスト表示。

**改善案:**
- 成功時にトースト通知で「○人読み込みました」を表示
- レーティング付きの人数も表示（例: 「15人読み込みました（レーティング付き: 12人）」）

---

## 改善実装プラン

### Phase 1: 上書き確認（優先度: 高）

テキストエリアに既存入力がある場合、上書き確認ダイアログを表示。

**変更ファイル:** `src/pages/SessionCreate.tsx`

```
handleLoadFromSheets() {
  if (playerNames.trim()) {
    // confirm() で確認
    if (!confirm('現在の入力を上書きしますか？')) return;
  }
  // ... 既存の読み込み処理
}
```

### Phase 2: 読み込みキャッシュ（優先度: 中）

最後に読み込んだメンバーを保存し、オフライン時に利用可能にする。

**変更ファイル:**
- `src/stores/settingsStore.ts` — `cachedMembers` フィールド追加
- `src/pages/SessionCreate.tsx` — キャッシュ復元ボタン追加

```typescript
// settingsStore に追加
interface SettingsState {
  gasWebAppUrl: string;
  cachedMembers: { name: string; rating?: number }[];
  cachedAt: number | null;  // キャッシュ日時
  setGasWebAppUrl: (url: string) => void;
  setCachedMembers: (members: { name: string; rating?: number }[]) => void;
}
```

SessionCreate画面:
```
┌──────────────────────────────┐
│  [Sheetsから読み込み]         │  ← GASから最新取得
│  [前回のメンバー (15人)]      │  ← キャッシュがある場合のみ表示
└──────────────────────────────┘
```

### Phase 3: 成功トースト（優先度: 低）

読み込み成功時にトースト通知を表示。

**変更ファイル:** `src/pages/SessionCreate.tsx`

---

## 実装しない判断

| 候補 | 理由 |
|------|------|
| CSVファイル直接読み込み | GAS連携で十分。ファイルAPIの複雑さに見合わない |
| 複数シート選択UI | 「当日参加者」固定で運用上問題ない |
| メンバー選択チェックボックス | テキストエリア編集で削除可能。UIが複雑になる |
| 自動読み込み（画面表示時） | 意図しないリクエスト防止。手動トリガーで十分 |
| リトライ機能 | タイムアウト10秒で十分。失敗時はユーザーが再タップ |

---

## 実装タスク（優先度順）

| # | タスク | 変更ファイル | 工数 |
|---|--------|------------|------|
| 1 | 上書き確認ダイアログ追加 | SessionCreate.tsx | 小 |
| 2 | settingsStoreにキャッシュフィールド追加 | settingsStore.ts | 小 |
| 3 | 読み込み成功時にキャッシュ保存 | SessionCreate.tsx | 小 |
| 4 | 「前回のメンバー」ボタン追加 | SessionCreate.tsx | 中 |
| 5 | 読み込み成功トースト表示 | SessionCreate.tsx | 小 |
| 6 | ビルド確認 | — | — |
