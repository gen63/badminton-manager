# 全体レイアウト見直し

**作成日**: 2026-02-05
**ステータス**: 計画中

---

## 1. 現状の課題

### 1.1 グローバルレイアウトが存在しない

各ページが独自にヘッダー・背景・パディングを実装しており、コードが重複している。

```
// 現状: 全ページでこのパターンが繰り返される
<div className="bg-app pb-20">
  <div className="header-gradient text-gray-800 p-3">
    <div className="max-w-6xl mx-auto flex items-center ...">
      {/* ヘッダー内容（ページごとに異なる） */}
    </div>
  </div>
  <div className="max-w-* mx-auto p-4">
    {/* コンテンツ */}
  </div>
</div>
```

**影響**:
- ヘッダーのスタイル・構造がページごとに微妙に異なる
- Toast通知が各ページで個別にレンダリングされている（DRY原則違反）
- 背景色・パディングに一貫性がない

### 1.2 ナビゲーションが分散している

- MainPage: ヘッダー右端に「履歴」「設定」アイコン
- HistoryPage / SettingsPage: ヘッダー左に「戻る」ボタン
- 現在どのページにいるかの視覚的なインジケータがない
- DESIGN.mdの「重要なボタンは画面下部に配置」に反している

### 1.3 MainPageが巨大すぎる（549行）

1つのコンポーネントに以下が混在:
- コート管理ロジック（配置・開始・終了・クリア）
- プレイヤー交換ロジック
- プレイヤーリスト表示
- スコア未入力試合の表示
- メンバー追加フォーム

**影響**: 保守性が低く、機能追加が困難

### 1.4 コートレイアウトがモバイルで窮屈

```jsx
// 現状: 3コートを横並び、各26%幅
<div className="flex" style={{ width: '26%' }}>
```

- スマートフォン（375px幅）で1コートあたり約97px → 名前が収まらない
- DESIGN.mdの44pxタップターゲットを満たすのが困難

### 1.5 コンテナ幅が不統一

| ページ | コンテナ幅 |
|--------|-----------|
| SessionCreate | `max-w-md` (448px) |
| MainPage | `max-w-6xl` (1152px) |
| HistoryPage | `max-w-6xl` (1152px) |
| SettingsPage | `max-w-2xl` (672px) |
| ScoreInputPage | `max-w-2xl` (672px) |

---

## 2. 改善方針

### 2.1 共通レイアウトコンポーネント導入

`App.tsx`レベルで共通レイアウトを定義し、各ページは「コンテンツ」のみに集中する。

```
App.tsx
├── <AppLayout>          ← 新規: 共通レイアウトラッパー
│   ├── <Header />       ← 新規: 統一ヘッダー
│   ├── <main>           ← ページコンテンツ（Routes）
│   │   └── <Outlet />
│   ├── <BottomNav />    ← 新規: ボトムタブナビゲーション
│   └── <Toast />        ← App.tsxレベルに1箇所のみ
└── <PWAPrompt />
```

### 2.2 ボトムタブナビゲーション導入

モバイルUXのベストプラクティスに従い、メインフロー（セッション作成後）のナビゲーションをボトムタブに統一する。

```
┌─────────────────────────┐
│ ヘッダー（ページタイトル）│
├─────────────────────────┤
│                         │
│     ページコンテンツ     │
│                         │
├─────────────────────────┤
│  コート │ メンバー │ 履歴 │ 設定  │  ← ボトムタブ
└─────────────────────────┘
```

**タブ構成**:

| タブ | アイコン | ラベル | 遷移先 |
|------|---------|--------|--------|
| コート | `LayoutGrid` | コート | `/main` (コート表示のみ) |
| メンバー | `Users` | メンバー | `/main/members` (プレイヤー管理) |
| 履歴 | `History` | 履歴 | `/history` |
| 設定 | `Settings` | 設定 | `/settings` |

**表示条件**:
- セッション作成前（`/`）: ボトムタブ非表示
- スコア入力画面（`/score/:id`）: ボトムタブ非表示
- それ以外: ボトムタブ表示

### 2.3 MainPageの分割

現在のMainPageを以下の2つのページに分離:

#### CourtPage（コート管理）
- コートカード表示（配置・開始・終了・クリア）
- 一括配置ボタン
- スコア未入力試合
- プレイヤー交換UI（コート内タップ → 待機者タップ）

#### MembersPage（メンバー管理）
- 待機中プレイヤーリスト
- 休憩中プレイヤーリスト
- メンバー追加フォーム
- プレイヤー交換UI（待機者タップ → コート内タップ）

**共有するstate**: `selectedPlayer`はZustand storeに移動し、両ページで共有する。

### 2.4 レスポンシブ対応のコートレイアウト

モバイルでは縦方向にスクロール、デスクトップでは横並び。

```
// モバイル（< 768px）: 縦に積む
┌─────────────────┐
│   コート ①       │
├─────────────────┤
│   コート ②       │
├─────────────────┤
│   コート ③       │
└─────────────────┘

// デスクトップ（≥ 768px）: 横並び
┌─────┐ ┌─────┐ ┌─────┐
│ ①  │ │ ②  │ │ ③  │
└─────┘ └─────┘ └─────┘
```

実装:
```jsx
<div className="flex flex-col md:flex-row gap-4 md:gap-5 md:justify-center md:items-stretch">
  {courts.map(court => (
    <div key={court.id} className="w-full md:w-[30%]">
      <CourtCard ... />
    </div>
  ))}
</div>
```

### 2.5 コンテナ幅の統一

| ページ | 変更前 | 変更後 | 理由 |
|--------|--------|--------|------|
| SessionCreate | `max-w-md` | `max-w-md` | フォーム画面は狭い方が使いやすい（変更なし） |
| CourtPage | `max-w-6xl` | `max-w-3xl` | モバイルでの視認性を優先 |
| MembersPage | — (新規) | `max-w-2xl` | リスト表示に適切な幅 |
| HistoryPage | `max-w-6xl` | `max-w-2xl` | リスト表示に適切な幅 |
| SettingsPage | `max-w-2xl` | `max-w-2xl` | 変更なし |
| ScoreInputPage | `max-w-2xl` | `max-w-md` | フォーム画面は狭い方がよい |

---

## 3. ファイル構成（変更後）

```
src/
├── components/
│   ├── layout/                ← 新規ディレクトリ
│   │   ├── AppLayout.tsx      ← 共通レイアウト
│   │   ├── Header.tsx         ← 統一ヘッダー
│   │   └── BottomNav.tsx      ← ボトムタブナビゲーション
│   ├── CourtCard.tsx
│   ├── Toast.tsx
│   ├── EmptyState.tsx
│   ├── LoadingSpinner.tsx
│   ├── PlayerSwapModal.tsx
│   └── PWAPrompt.tsx
├── pages/
│   ├── SessionCreate.tsx      ← 変更: ヘッダー・背景を除去
│   ├── CourtPage.tsx          ← 新規: MainPageからコート部分を分離
│   ├── MembersPage.tsx        ← 新規: MainPageからメンバー部分を分離
│   ├── HistoryPage.tsx        ← 変更: ヘッダー・背景を除去
│   ├── SettingsPage.tsx       ← 変更: ヘッダー・背景を除去
│   └── ScoreInputPage.tsx     ← 変更: 独自レイアウト維持（モーダル的）
├── stores/
│   ├── uiStore.ts             ← 新規: selectedPlayer等のUI状態
│   ├── sessionStore.ts
│   ├── playerStore.ts
│   ├── gameStore.ts
│   └── settingsStore.ts
├── App.tsx                    ← 変更: AppLayoutでRoutesをラップ
└── ...
```

---

## 4. 詳細設計

### 4.1 AppLayout コンポーネント

```tsx
// src/components/layout/AppLayout.tsx
export function AppLayout() {
  const { session } = useSessionStore();
  const location = useLocation();

  // セッション未作成 or スコア入力画面ではシンプルレイアウト
  const isSimpleLayout = !session || location.pathname.startsWith('/score');

  return (
    <div className="bg-app min-h-screen flex flex-col">
      {!isSimpleLayout && <Header />}

      <main className="flex-1 pb-safe">
        <Outlet />
      </main>

      {!isSimpleLayout && <BottomNav />}

      <GlobalToast />
    </div>
  );
}
```

### 4.2 Header コンポーネント

ページタイトルとコンテキストアクション（一括配置、コピー等）を表示。

```tsx
// src/components/layout/Header.tsx
export function Header() {
  const location = useLocation();

  const config = getHeaderConfig(location.pathname);
  // { title: 'コート', actions: [...] }

  return (
    <header className="header-gradient text-gray-800 p-3 sticky top-0 z-10">
      <div className="max-w-3xl mx-auto flex items-center justify-between">
        <h1 className="text-lg font-bold">{config.title}</h1>
        <div className="flex items-center gap-2">
          {config.actions}
        </div>
      </div>
    </header>
  );
}
```

**ヘッダーのページ別設定**:

| ページ | タイトル | アクション |
|--------|---------|-----------|
| CourtPage | コート | 一括配置ボタン |
| MembersPage | メンバー | — |
| HistoryPage | 履歴 | Sheets送信, CSVコピー |
| SettingsPage | 設定 | — |

### 4.3 BottomNav コンポーネント

```tsx
// src/components/layout/BottomNav.tsx
const tabs = [
  { path: '/main', icon: LayoutGrid, label: 'コート' },
  { path: '/members', icon: Users, label: 'メンバー' },
  { path: '/history', icon: History, label: '履歴' },
  { path: '/settings', icon: Settings, label: '設定' },
];

export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 pb-safe z-20">
      <div className="max-w-3xl mx-auto flex">
        {tabs.map(tab => {
          const isActive = location.pathname === tab.path
            || (tab.path === '/main' && location.pathname === '/main');
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className={`flex-1 flex flex-col items-center py-2 min-h-[56px]
                ${isActive ? 'text-indigo-600' : 'text-gray-400'}`}
            >
              <tab.icon size={22} />
              <span className="text-[10px] mt-0.5 font-medium">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
```

**デザイン仕様**:
- 高さ: 56px + safe-area-inset-bottom
- アクティブ状態: インディゴ（`text-indigo-600`）
- 非アクティブ状態: グレー（`text-gray-400`）
- タップターゲット: 各タブ25%幅 × 56px高 → 44px以上を確保

### 4.4 App.tsx ルーティング変更

```tsx
// src/App.tsx
function App() {
  return (
    <BrowserRouter basename="/badminton-manager">
      <Routes>
        {/* セッション作成（レイアウトなし） */}
        <Route path="/" element={<SessionCreate />} />

        {/* メインフロー（共通レイアウト） */}
        <Route element={<AppLayout />}>
          <Route path="/main" element={<CourtPage />} />
          <Route path="/members" element={<MembersPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>

        {/* スコア入力（独自レイアウト） */}
        <Route path="/score/:matchId" element={<ScoreInputPage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <PWAPrompt />
    </BrowserRouter>
  );
}
```

### 4.5 uiStore（UI状態管理）

`selectedPlayer`をZustandストアに移動し、CourtPageとMembersPage間で共有。

```tsx
// src/stores/uiStore.ts
interface UIState {
  selectedPlayer: {
    id: string;
    courtId?: number;
    position?: number;
  } | null;
  setSelectedPlayer: (player: UIState['selectedPlayer']) => void;
  clearSelectedPlayer: () => void;
}
```

### 4.6 GlobalToast

各ページから個別のToast実装を削除し、App.tsxレベルで1箇所にまとめる。

```tsx
// useToast hookのtoasts stateをZustand storeに移動
// src/stores/toastStore.ts
interface ToastState {
  toasts: ToastItem[];
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  hideToast: (id: string) => void;
}
```

---

## 5. 実装ステップ

### Phase 1: レイアウト基盤（インフラ）

1. **`toastStore.ts`作成** — Toast状態をZustandに移動
2. **`uiStore.ts`作成** — selectedPlayer等のUI状態
3. **`AppLayout.tsx`作成** — 共通レイアウトラッパー
4. **`Header.tsx`作成** — 統一ヘッダー
5. **`BottomNav.tsx`作成** — ボトムタブナビゲーション
6. **`App.tsx`変更** — ネストルーティング導入

### Phase 2: ページ分割・移行

7. **`CourtPage.tsx`作成** — MainPageのコート管理部分を移植
8. **`MembersPage.tsx`作成** — MainPageのメンバー管理部分を移植
9. **各ページからヘッダー・背景・Toast削除** — AppLayoutに委譲
10. **`MainPage.tsx`削除** — CourtPageとMembersPageに完全移行

### Phase 3: レスポンシブ改善

11. **CourtCardレスポンシブ対応** — モバイル縦積み / デスクトップ横並び
12. **コンテナ幅の統一** — 各ページの`max-w-*`を見直し

### Phase 4: 検証・仕上げ

13. **ビルド確認** — `npm run build`でエラーがないこと
14. **モバイル表示確認** — iPhone SE (375px)、iPhone 14 (390px) でのレイアウト
15. **タブナビゲーション動作確認** — 全タブの遷移と状態保持

---

## 6. 考慮事項

### 6.1 状態保持

ボトムタブ切り替え時にページのスクロール位置やフォーム入力を保持するか。

**判断**: Zustandストアで管理しているため、タブ切り替え時もデータは保持される。スクロール位置は保持しない（シンプルさを優先）。

### 6.2 SessionCreate画面のレイアウト

セッション作成画面はAppLayoutの外に置き、独自レイアウトを維持する。理由:
- ボトムタブは不要（セッション未作成状態）
- ヘッダーも不要（この画面自体がエントリーポイント）

### 6.3 ScoreInputPage画面のレイアウト

スコア入力はモーダル的な画面のため、AppLayoutの外に置く。理由:
- ボトムタブは操作の邪魔になる
- 集中して入力させたい画面

### 6.4 PlayerSelectページ

現在`/players`は設定画面からリンクされているが、MembersPageがその役割を担うため、`/players`は不要になる可能性がある。MembersPageに統合を検討。

### 6.5 ボトムナビゲーションの高さ分のパディング

`<main>`にボトムナビの高さ分の`padding-bottom`が必要。BottomNavが`fixed`のため、コンテンツが隠れないようにする。

```css
/* BottomNavの高さ(56px) + safe-area */
main {
  padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px));
}
```

---

## 7. 非対象（スコープ外）

- SessionCreate画面のデザイン変更
- ScoreInputPageのデザイン変更
- アルゴリズム（配置ロジック）の変更
- Zustand storeの構造変更（uiStore/toastStore以外）
- Google Sheets連携機能の変更
