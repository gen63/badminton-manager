# シングルスモード時のコート追加・手動配置変更を管理者限定

作成日: 2026-04-20

## 背景・目的

シングルスモードは 1 コート 2 人のため、ダブルスよりもコートの増減や手動での配置変更がゲーム進行に与える影響が大きい（待機人数バランスが崩れやすく、試合公平性を損ないやすい）。
現在はオンラインセッション参加者の誰もがコート追加・配置変更を行えるため、非管理者の誤操作で進行が乱れるケースが発生する。

そこで **シングルスモード時に限り、以下の操作を管理者権限保有者のみに制限する**:

1. コート追加（`handleAddCourt`）
2. 手動配置変更（プレイヤータップによる交換 = `handlePlayerTap` / `handleSwapPlayer`）

ダブルスモード時の動作は従来通り（全員が操作可能）。

## 参照ドキュメント

- `docs/plans/2026-03-10-singles-mode.md` — シングルスモード導入時の設計
- `docs/plans/2026-04-17-dev-mode-creator-and-ttl.md` — 管理者判定の既存実装
- `docs/plans/2026-03-06-management-tabs.md` — 管理者設定管理

## 既存実装の整理

### 管理者判定

`src/stores/sessionStore.ts:78-87` に `isAdmin()` が存在。
ローカルモード（`session.createdBy` 無し）では全員管理者扱い、オンラインモードでは
`currentUser === session.createdBy` または `session.admins[]` に含まれる場合のみ true。
dev-mode localStorage フラグでも true を返す。

### シングルスモード判定

`src/pages/MainPage.tsx:40` にて
`const gameMode = session?.config.gameMode ?? 'doubles';`

### 対象ハンドラ・UI

| 操作               | ハンドラ                       | 呼び出し元                                |
| ------------------ | ------------------------------ | ----------------------------------------- |
| コート追加         | `handleAddCourt` (L189-223)    | コート追加ボタン (L965-980)                |
| 手動配置変更（選択→交換） | `handlePlayerTap` (L497-578) | 待機プレイヤー (L1039), コート上プレイヤー (L777, L806) |

`PlayerSwapModal.tsx` は現状どこからも import されていないため対象外。

## 実装方針

### 1. 権限判定変数の追加

`MainPage.tsx` 上部に以下を追加:

```tsx
const canManageSingles = gameMode !== 'singles' || isAdmin();
```

- シングルスモード **ではない** 場合: 常に `true`（従来通り誰でも操作可）
- シングルスモード **かつ** 非管理者: `false`
- `isAdmin()` は `useSessionStore` から取得（既に L29 で destructure 済）

### 2. ハンドラにガード追加（防御的）

UI 側で disabled にするだけでは、DOM 改変や競合で呼ばれる可能性があるため、
ハンドラ内部でも早期 return する。

```ts
const handleAddCourt = async () => {
  if (!canManageSingles) {
    toast.error('シングルスモードでは管理者のみコートを追加できます');
    return;
  }
  // 既存処理
};

const handlePlayerTap = (...) => {
  if (!canManageSingles) return;  // サイレント無視（トースト出さない）
  // 既存処理
};
```

`handlePlayerTap` は頻繁に呼ばれる UI イベントなのでトーストは出さず、
ボタン側を `disabled` にして押せないよう見せる。

### 3. UI の disabled 化

- **コート追加ボタン** (L965): 既存の `canAddCourt` に `canManageSingles` を AND。
  プレイヤー数不足時と区別できるよう、非権限時の表示は「管理者のみ」とする。
- **待機プレイヤータップボタン** (L1037付近): `disabled={!canManageSingles}` を付与。
  既存の休憩ボタン (`handleToggleRestWithLock`) と性別/名前編集は残す。
- **コート上プレイヤータップボタン** (L775, L804): `disabled={!canManageSingles}` を付与。

### 4. 対象外

- `handleRemoveCourt` — ユーザー要求に含まれていない。もし必要なら別途対応。
- `handleAutoAssign`, `handleStartGame`, 連続モード, 休憩切替, スコア入力等 — 対象外。
- ダブルスモードの挙動 — 一切変更しない。

## テスト観点

- シングルスモード & 非管理者（オンラインセッション参加者）:
  - コート追加ボタンが disabled 表示になる
  - コート上/待機プレイヤーをタップしても選択状態にならない
- シングルスモード & 管理者:
  - 従来通りコート追加・配置変更ができる
- ダブルスモード: 従来通り誰でも操作可
- ローカルモード（`createdBy` なし）: `isAdmin()` が true を返すので制限なし
- dev-mode: `isAdmin()` が true を返すので制限なし

## コミット前チェック

```bash
npm run build
npm run lint
npm run test:run
```

## ブランチ

`claude/admin-only-court-management-AKFtX`
