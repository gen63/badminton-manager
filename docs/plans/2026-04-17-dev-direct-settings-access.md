# dev mode 時の設定画面への直接遷移導線

## Context

dev mode (`?dev=1`) の主な用途は「他人が作ったセッションを保守・検証する」こと。
`SettingsPage` にはすでに dev 専用の「セッション削除」カード (L537-554) があり、
`isAdmin()`/`isCreator()` は dev mode で true を返すバイパスが入っている
（`2026-04-17-dev-mode-creator-and-ttl.md` 参照）。

しかし現状、セッション選択画面 (`SessionSelectPage`) から遷移した先は
`SessionJoinPage` で、そこには「名前を選んで入室する」動線しか存在しない。
参加者として join せずに設定画面に入る手段がなく、
dev mode でセッションを削除したい場合でも誰かの名前を借りて入室 → メイン画面
→ 歯車アイコン、と遠回りを強いられていた。

## 設計方針

`SessionJoinPage` に dev mode 限定の「[DEV] 設定画面を開く」ボタンを追加する。

- 押下時に取得済みの `session` を `initializeSession()` でストアに投入
- `initializeSession` が `currentUser = session.createdBy` をセットするため
  `SettingsPage` のオンラインモード時 `currentUser` 必須ガード (L47-55) を通過
- `isAdmin()` / `isCreator()` は dev mode バイパスで true を返すので
  権限ガード (L58) も通過
- `join` 処理 (`joinSession`) は呼ばないので、participants には追加されない
- `navigate('/settings')` で設定画面へ

## 変更ファイル

### `src/pages/SessionJoinPage.tsx`

- `useDevMode` をインポート、`const devMode = useDevMode();` を追加
- 「入室する」ボタンの下、dev mode 有効時のみ以下を表示:
  - 点線グレー枠 + `[DEV]` バッジ付きボタン「設定画面を開く（入室せず）」
  - ハンドラ:
    ```ts
    const handleOpenSettingsAsDev = () => {
      if (!sessionId || !session) return;
      initializeSession({
        id: sessionId,
        config: session.config,
        createdAt: session.createdAt,
        updatedAt: Date.now(),
        createdBy: session.createdBy,
        participants: session.participants,
        registeredPlayers: session.registeredPlayers,
        status: session.status,
      });
      navigate('/settings');
    };
    ```

## 影響範囲

- 通常ユーザー（dev mode 無効）の UI は変化しない
- dev mode 有効時のみボタン 1 つが追加される
- `SettingsPage` への新しい到達経路が増えるが、既存の権限判定で自然にカバーされる

## 検証

- `npm run build` / `npm run lint` / `npm run test:run` 通過
- 手動：
  - `/?dev=1` でトップ表示 → 任意のセッションを選択 → `SessionJoinPage` で
    「[DEV] 設定画面を開く」ボタンが表示される
  - 押下 → 設定画面に遷移、dev 用のセッション削除カードが見える
  - 通常 URL（`?dev=1` 未経験ブラウザ）では当該ボタンが表示されない
