# スプレッドシート読み込み不具合の修正

## 概要

セッション作成画面の「Sheetsから読み込み」ボタンで、ネットワーク接続があるにもかかわらずスプレッドシート読み込みに失敗する問題を修正する。

**報告:** 「ネットワークは繋がっているのにセッション開始画面でスプレッドシート読み込みに失敗する」

## 原因分析

6つの問題を特定。優先度順に記載。

### 問題1: GAS Cold Start タイムアウト（最も高頻度）

**現状:** `src/lib/sheetsMembers.ts` L20 でタイムアウトが **10秒** に設定。

```typescript
const timeoutId = setTimeout(() => controller.abort(), 10000);
```

**問題:** Google Apps Script の Cold Start は **15-30秒** かかることがある。初回アクセスや長時間未使用後のアクセスで AbortError → 「読み込みがタイムアウトしました」。2回目以降は GAS がウォームなので成功するが、リトライ機構がないため1回で失敗扱い。

### 問題2: リトライ機構がない

1回の fetch 失敗で即座にエラーを返す。GAS Cold Start は一時的な問題で、直後のリトライなら高確率で成功する。

### 問題3: 誤解を招くエラーメッセージ

**現状の catch-all:**

```typescript
return {
  success: false,
  message: '読み込みに失敗しました。Wi-Fi接続を確認してください',
  members: [],
};
```

CORS エラー、JSON パースエラー、リダイレクトエラーなど **すべてのエラーが「Wi-Fi接続を確認してください」** になる。ネットワークに繋がっているユーザーにとっては混乱の原因。

### 問題4: 非JSON レスポンスの未処理

GAS が認証ページや HTML エラーページを返した場合、`response.json()` が SyntaxError を投げ、問題3の catch-all で「Wi-Fi接続を確認してください」になる。

### 問題5: Zustand Store ハイドレーション競合

`SessionCreate.tsx` L30:

```typescript
const [gasUrlInput, setGasUrlInput] = useState(gasWebAppUrl);
```

Zustand `persist` は localStorage から非同期にハイドレーションする。初回レンダー時 `gasWebAppUrl` が `''` の可能性があり、`gasUrlInput` が空文字で固定される。

`handleLoadFromSheets` は `gasUrlInput || gasWebAppUrl` としているため通常は問題ないが、ハイドレーション完了前に素早くボタンを押すとエラーになる。また、ハイドレーション前は URL 入力欄がちらつく。

### 問題6: GAS リダイレクト CORS エッジケース

GAS Web App は `script.google.com` → `script.googleusercontent.com` にリダイレクトする。GET の simple request として透過的に処理されるため大多数のブラウザでは問題ないが、一部のモバイルブラウザ/WebView でリダイレクト中間レスポンスに CORS ヘッダーがなく失敗する可能性がある。影響頻度は低い。

## 修正方針

影響範囲を `src/lib/sheetsMembers.ts` と `src/pages/SessionCreate.tsx` の **2ファイル** に限定する。GAS スクリプトの変更は不要。

## 実装タスク

### タスク1: タイムアウト延長 + 自動リトライ（sheetsMembers.ts）

**タイムアウト:** 10秒 → **30秒** に延長（GAS Cold Start の最悪ケースをカバー）

**リトライ:** 最大2回（初回 + リトライ1回、間隔1秒）

```typescript
export async function fetchMembersFromSheets(
  url: string,
  onRetry?: () => void
): Promise<FetchMembersResult> {
  if (!url) {
    return { success: false, message: 'GAS URLが設定されていません', members: [] };
  }

  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await attemptFetch(url);
    if (result.success || !result.retryable || attempt === MAX_ATTEMPTS) {
      return { success: result.success, message: result.message, members: result.members };
    }
    onRetry?.();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return { success: false, message: '読み込みに失敗しました', members: [] };
}
```

**リトライ判定:**

| エラー種別 | retryable | 理由 |
|-----------|-----------|------|
| AbortError（タイムアウト） | Yes | Cold Start は一時的 |
| TypeError（ネットワーク/CORS） | Yes | 一時的な接続問題の可能性 |
| SyntaxError（JSON パース失敗） | Yes | GAS が一時的に HTML を返すケース |
| HTTP 5xx | Yes | サーバー一時エラー |
| HTTP 4xx | **No** | 設定ミスの可能性（リトライしても直らない） |
| GAS 側エラー（`status: 'error'`） | **No** | シート名不正等（リトライしても直らない） |

### タスク2: エラーメッセージの分類と改善（sheetsMembers.ts）

catch ブロックを細分化：

| エラー | 現在のメッセージ | 修正後メッセージ |
|--------|----------------|-----------------|
| AbortError | 読み込みがタイムアウトしました | 読み込みがタイムアウトしました。しばらく待ってから再度お試しください |
| SyntaxError | Wi-Fi接続を確認してください | GASの応答を解析できません。GASの再デプロイをお試しください |
| TypeError | Wi-Fi接続を確認してください | ネットワークエラーが発生しました。接続を確認してください |
| HTTP 5xx | 読み込みエラー (5xx) | サーバーエラーが発生しました。しばらく待ってから再度お試しください |
| その他 | Wi-Fi接続を確認してください | 読み込みに失敗しました |

### タスク3: Content-Type / JSON パース安全化（sheetsMembers.ts）

`response.json()` の代わりに `response.text()` + `JSON.parse()` を使用。GAS リダイレクト先が `text/javascript` を返すケースにも対応。

```typescript
const text = await response.text();
let data: unknown;
try {
  data = JSON.parse(text);
} catch {
  return {
    success: false,
    message: 'GASの応答を解析できません。GASの再デプロイをお試しください',
    members: [],
    retryable: true,
  };
}
```

### タスク4: Zustand ハイドレーション対応（SessionCreate.tsx）

`gasUrlInput` の初期値を空文字に変更し、URL 選択の優先順位を修正：

```typescript
// Before
const [gasUrlInput, setGasUrlInput] = useState(gasWebAppUrl);
const url = gasUrlInput || gasWebAppUrl;

// After
const [gasUrlInput, setGasUrlInput] = useState('');
const url = gasWebAppUrl || gasUrlInput;
```

ストアがハイドレーション済みであればストアの値が使われ、`gasUrlInput` はフォールバック。

### タスク5: ローディング中のリトライ表示（SessionCreate.tsx）

`onRetry` コールバックを活用し、リトライ時に「再試行中...」を表示：

```typescript
const [loadingText, setLoadingText] = useState('読み込み中...');

const result = await fetchMembersFromSheets(url, () => {
  setLoadingText('再試行中...');
});
```

### タスク6: ビルド確認

```bash
npm run build
```

## 変更ファイル一覧

| ファイル | 操作 | 変更内容 |
|----------|------|----------|
| `src/lib/sheetsMembers.ts` | **変更** | タイムアウト延長、リトライ追加、エラー分類改善、JSON パース安全化 |
| `src/pages/SessionCreate.tsx` | **変更** | `gasUrlInput` 初期値修正、URL 優先順位修正、リトライ中テキスト表示 |

## テスト計画

| # | シナリオ | 期待結果 |
|---|---------|----------|
| 1 | GAS Cold Start（長時間未使用後） | 30秒以内に成功、もしくはリトライで成功 |
| 2 | GAS URL 未設定でボタン押下 | 「GAS Web App URLを入力してください」 |
| 3 | 不正な URL | 「ネットワークエラーが発生しました」 |
| 4 | GAS が HTML を返す（認証切れ） | 「GASの応答を解析できません」 |
| 5 | GAS 側エラー（シート名不正） | GAS のエラーメッセージ表示 |
| 6 | ネットワーク切断 | 「ネットワークエラーが発生しました」 |
| 7 | 正常読み込み | 「N人を読み込みました」 |
| 8 | ページ表示直後に即ボタン押下 | 正常動作 |

## 設計判断

| 判断 | 理由 |
|------|------|
| タイムアウト30秒 | GAS Cold Start の最悪ケース（15-30秒）をカバー。60秒は長すぎる |
| リトライ最大2回 | Cold Start は1回で解消。3回以上はユーザーを待たせすぎる |
| リトライ間隔1秒 | Cold Start 後はすぐ使えるため長い待機は不要 |
| `retryable` フラグは内部のみ | 外部インタフェース `FetchMembersResult` は変更しない |
| JSON パースは `text()` + `JSON.parse()` | Content-Type が不安定な GAS に対して堅牢 |
| `sheetsApi.ts` は今回のスコープ外 | POST は `no-cors` で仕組みが異なる。別途対応 |
| `gasUrlInput` 初期値を `''` に変更 | ハイドレーション前の stale な値をキャプチャしない |
| `onRetry` コールバック | UI側にリトライ状態を伝える最小限のインタフェース |

## 実装順序

1. `src/lib/sheetsMembers.ts` — タイムアウト延長 + エラー分類 + JSON パース安全化
2. `src/lib/sheetsMembers.ts` — リトライロジック追加（`onRetry` コールバック含む）
3. `src/pages/SessionCreate.tsx` — `gasUrlInput` 初期値修正 + リトライ中テキスト表示
4. `npm run build` — ビルド確認

## 参考

- `docs/plans/2026-02-05-google-sheets-members-integration.md`
- `docs/plans/2026-02-05-google-sheets-integration.md`
