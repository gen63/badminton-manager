# シングルスモード時のコート追加・手動配置変更を管理者限定

作成日: 2026-04-20

## 背景・目的

シングルスモードは 1 コート 2 人のため、ダブルスよりもコートの増減や手動での配置変更がゲーム進行に与える影響が大きい（待機人数バランスが崩れやすく、試合公平性を損ないやすい）。
現在はオンラインセッション参加者の誰もがコート追加・配置変更を行えるため、非管理者の誤操作で進行が乱れるケースが発生する。

そこで **シングルスモード時に限り、以下の操作を管理者権限保有者のみに制限する**:

1. コート追加 (`handleAddCourt`)
2. 手動配置変更 = プレイヤータップによる「選択 → 交換」(`handlePlayerTap` + `handleSwapPlayer`)

ダブルスモード時の動作は従来通り（全員が操作可能）。

## 参照ドキュメント

- `docs/plans/2026-03-10-singles-mode.md` — シングルスモード導入時の設計
- `docs/plans/2026-04-17-dev-mode-creator-and-ttl.md` — 管理者判定の既存実装
- `docs/plans/2026-03-06-management-tabs.md` — 管理者設定管理

## 既存実装の整理

### 管理者判定 (`src/stores/sessionStore.ts:78-87`)

```ts
isAdmin: () => {
  const { session, currentUser } = get();
  if (!session?.createdBy) return true;          // ローカルモード
  if (isDevMode()) return true;                  // dev モード
  if (!currentUser) return false;
  return currentUser === session.createdBy
    || session.admins?.includes(currentUser) || false;
}
```

- ローカルモード (createdBy 無し): 全員 true
- dev モード (`localStorage['dev-mode'] === '1'`): true
- オンライン + 作成者 / admins 入り: true
- それ以外: false

### シングルスモード判定 (`src/pages/MainPage.tsx:40`)

```ts
const gameMode = session?.config.gameMode ?? 'doubles';
```

### 対象ハンドラ・UI

| 操作               | ハンドラ                       | 呼び出し元 UI                                         |
| ------------------ | ------------------------------ | ----------------------------------------------------- |
| コート追加         | `handleAddCourt` (L189-223)    | コート追加ボタン (L965-980)                           |
| 手動配置変更       | `handlePlayerTap` (L497-578) → `handleSwapPlayer` (L425-453) | 待機プレイヤー (L1039), コート上プレイヤー (L777, L806) |

### 本対応の範囲外 (意図的に含めないもの)

ユーザー要求「コート追加」「手動配置変更」に厳密に従い、以下は制限対象外とする。
必要であれば別課題で対応。

- `handleRemoveCourt` (L225) — コート削除
- `handleClearCourt` (L184) — コート上プレイヤーのクリア
- `handleAutoAssign` (L255) — 自動配置 (「配置」「一括配置」ボタン)
- `handleContinuousNext` (L354) — 連続モードの自動配置
- `handleToggleRestWithLock` — 休憩トグル
- Undo/Redo — シングルスモードでも誰でも使える
- `PlayerSwapModal` — 現状どこからも import されておらず実質 dead code

## 実装方針

### 1. 権限判定変数の追加 (`MainPage.tsx`)

`handleAddCourt` 定義の直前、既存コンポーネントのロジック部に以下を追加:

```tsx
const canManageSingles = gameMode !== 'singles' || isAdmin();
```

- シングルスモード **ではない** → 常に `true`（従来通り）
- シングルスモード **かつ** 非管理者 → `false`
- `isAdmin` は既に L29 で destructure 済。Zustand ストアの変化 (session.admins 更新等) で
  コンポーネントは再 render され `canManageSingles` も再評価される。

### 2. ハンドラへのガード追加 (Defense in Depth)

UI で disable しても、DOM 改変や race で呼ばれる恐れがある。ハンドラ側でも早期 return。

#### 2-1. `handleAddCourt`

```ts
const handleAddCourt = async () => {
  if (!canManageSingles) {
    toast.error('シングルスモードでは管理者のみコートを追加できます');
    return;
  }
  if (courts.length < 3) { /* 既存処理 */ }
};
```

トースト表示あり（ユーザーがなぜ追加できないか明示したい頻度・影響が大きい操作）。

#### 2-2. `handleSwapPlayer`

```ts
const handleSwapPlayer = (courtId, position, newPlayerId) => {
  if (!canManageSingles) return;
  /* 既存処理 */
};
```

サイレント無視。複数経路からの保険。

#### 2-3. `handlePlayerTap` — **休憩復帰経路は維持する**

`handlePlayerTap` は以下 3 種の入口を持つ:

1. **コート上プレイヤータップ** (L777, L806) — 交換専用 → 制限対象
2. **待機プレイヤータップ** (L1039) — 交換専用 → 制限対象
3. **休憩プレイヤータップ** (L1113) — 2 種類の用途:
   - (a) コート上プレイヤー選択中に休憩者をタップ = 交換（配置変更）→ 制限対象
   - (b) 何も選択していないとき休憩者をタップ = 休憩解除（復帰）→ **制限しない**

したがって一律 early return は誤り。**交換経路のみガード** する:

```ts
const handlePlayerTap = (playerId, courtId?, position?) => {
  const player = players.find(p => p.id === playerId);

  if (player?.isResting) {
    if (selectedPlayer?.courtId !== undefined && selectedPlayer?.position !== undefined) {
      // 交換経路 (3-a): 管理者のみ
      if (!canManageSingles) {
        setSelectedPlayer(null);
        return;
      }
      handleSwapPlayer(selectedPlayer.courtId, selectedPlayer.position, playerId);
      setSelectedPlayer(null);
    } else {
      // 復帰経路 (3-b): 誰でも可
      toggleRest(playerId);
      setSelectedPlayer(null);
    }
    return;
  }

  // 以降は待機/コート上タップ = 選択開始 or 交換 → 管理者のみ
  if (!canManageSingles) return;

  /* 既存の選択・交換処理 */
};
```

注: 待機/コート上タップの選択開始 (B1) がブロックされれば `selectedPlayer` は
非管理者では set されない。よって (3-a) 交換経路は理論上到達不能だが、
念のためガードを重ねる。

### 3. UI の disable 化

#### 3-1. コート追加ボタン (L965-980)

既存 `canAddCourt` の計算に権限を AND:

```ts
const canAddCourt =
  courts.length < 3
  && totalActiveCount >= (courts.length + 1) * playersPerCourt
  && canManageSingles;
```

ラベルは 3 状態で分岐:

- 追加可能: 「コート追加」
- プレイヤー不足: 「プレイヤー不足」(既存)
- 非権限 (singles & !admin): 「管理者のみ」

#### 3-2. プレイヤータップボタン

- **待機プレイヤー** (L1037-): `disabled={!canManageSingles}` を付与
- **コート上プレイヤー** (L775, L804): `disabled={!canManageSingles}` を付与
- **休憩プレイヤー** (L1113): **disabled を付けない** (復帰操作は全員許可)

既存の `isSelected`/`isReserved` 等のスタイリングはそのまま維持。

### 4. selectedPlayer のクリーンアップ

`canManageSingles` が false に変化した際、`selectedPlayer` が残っていると
画面下の「X と交換」バナー (L985-1000) がゾンビ表示される。
useEffect で false 化時にリセット:

```ts
useEffect(() => {
  if (!canManageSingles) setSelectedPlayer(null);
}, [canManageSingles]);
```

gameMode 切替や admins 更新時にクリアされる保険。

## 実装順序

1. `canManageSingles` と useEffect を MainPage の既存ロジック位置に追加
2. `handleAddCourt`, `handleSwapPlayer`, `handlePlayerTap` にガード追加
3. `canAddCourt` を更新、コート追加ボタンのラベルを 3 分岐
4. 待機/コート上プレイヤーボタンに `disabled` 付与
5. `npm run build && npm run lint && npm run test:run`
6. コミット & push

## テスト観点 (手動確認)

ローカルモード (createdBy 無し):
- singles, doubles 共に従来通り (isAdmin → true)

オンラインモード:
- **singles & 作成者**: コート追加・プレイヤー交換ができる
- **singles & admins 入り**: 同上
- **singles & 非管理者**: コート追加ボタンが「管理者のみ」表示で disabled、
  待機/コート上プレイヤーをタップしても選択状態にならない、
  休憩中プレイヤーをタップすれば復帰する
- **doubles & 非管理者**: 従来通りコート追加・交換可能

dev モード (`localStorage['dev-mode']='1'`):
- 全ケースで管理者扱い (isAdmin → true) なので制限なし

## コミット前チェック (CLAUDE.md 必須)

```bash
npm run build    # 型チェック + ビルド
npm run lint     # コードスタイル
npm run test:run # ユニットテスト
```

## ブランチ

`claude/admin-only-court-management-AKFtX`
