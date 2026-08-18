# 設定画面にセッションURLコピーを復活

## Context

セッション URL / QR の共有 UI は `2026-05-07-remove-url-qr-sharing.md` で撤去した。
理由は「全員がセッション一覧で同じアクティブセッション群を見られるので、個別の URL 共有は
不要」だったが、その前提が今日の 2 つの変更で崩れた:

- `2026-08-18-session-list-hide-after-last-match.md` — 一覧から消えるのが最後の試合終了から
  30 分と、大幅に早くなった
- `2026-08-18-session-auto-exit-after-practice.md` — 同条件でセッションから退出させる

一覧に出ないセッションへメンバーを入れる手段が dev モードしか無くなるため、**緊急避難措置**
として設定画面に URL コピーだけを戻す。QR と、作成直後の URL 表示画面は戻さない。

## スコープ

- **戻すもの**: 設定画面のセッション URL 表示 + コピーボタン
- **戻さないもの**: QR コード（`qrcode.react` 依存）、`SessionCreate` の作成完了後 URL 画面、
  `SessionJoinPage` の「他の参加者に共有」アコーディオン

## 配置と権限

`SettingsPage` は **管理者のみ**アクセスできる（非管理者は `/main` へリダイレクト）。
緊急避難措置は「管理者がメンバーへ連携する」運用なので、この権限のままでよく、追加の
権限分岐は入れない。

カードは「リセット」の**手前**に置く（破壊的操作は最下部のまま）。

## 実装

### `src/lib/utils.ts`

`buildSessionUrl(origin, base, sessionId)` を追加。`base` は `BrowserRouter` の basename と
同じ `import.meta.env.BASE_URL`（vite の `base: '/badminton-manager/'`）を渡す想定で、
前後のスラッシュ有無に関わらず `<origin>/<base>/session/<id>` に正規化する。
URL 組み立てだけ純粋関数に切り出してユニットテスト可能にする。

### `src/pages/SettingsPage.tsx`

- `sessionUrl` を `buildSessionUrl` で算出。
- 「セッションURL」カード: 説明文 + URL 表示（`bg-muted` / `font-mono` / `break-all`）+
  コピーボタン。
- `handleCopyUrl` は既存の `copyToClipboard`（`src/lib/utils.ts`、legacy fallback 付き）を
  使い、成否をトーストで通知。成功時は 2 秒間だけボタンを Check アイコン +
  「コピーしました」表示に切り替える。
- ボタンは DESIGN.md 準拠で `min-h-[44px]` / `active:scale-[0.98]`、リンク系なので青系。

### テスト

`src/lib/utils.test.ts` に `buildSessionUrl` の正規化テスト（base のスラッシュ有無 4 通り、
base がルート、origin の末尾スラッシュ）。

## 検証

```bash
npm run build && npm run lint && npm run test:run
```

手動確認:
1. 設定画面に「セッションURL」カードが出て、URL が `https://<host>/badminton-manager/session/<ID>` になっている。
2. コピーボタンでクリップボードに入り、トーストとボタン表示が切り替わる。
3. コピーした URL を別端末で開くと `SessionJoinPage` に入れる（一覧から消えていても入れる）。
