# セッション選択画面へのフィルタ追加

- 日付: 2026-07-20
- ブランチ: `claude/session-selection-filters-ms8hhp`
- 対象画面: `src/pages/SessionSelectPage.tsx`

## 目的

セッション選択画面のセッション数が増えると目的のセッションを見つけにくい。
**体育館 / 種別 / 日時** の 3 軸でフィルタを掛けて絞り込めるようにする。

## 対象データ

`Session`（`src/types/session.ts`）より:

- 体育館: `session.config.gym`（`string | undefined`。候補は `GYM_OPTIONS`）
- 種別: `resolvePracticeTypeLabel(session)` → `単 / 複 / 楽 / 不明`
- 日時: `session.config.practiceStartTime`（Unix ms）。カレンダー日単位で束ねる

## 仕様

### フィルタバー

- セッション一覧（`visibleSessions`）の**上**にフィルタ用カードを表示する。
- `visibleSessions.length > 0` のときだけ表示（0 件のときは出さない）。
- 3 軸それぞれ **単一選択**（暗黙の「すべて」を含む）。3 軸は **AND** で合成。
- 選択肢は **現在表示中の `visibleSessions` から動的に導出**する
  （固定の `GYM_OPTIONS` 全部ではなく、実際に存在する値だけ。Hick's Law）。
  - 体育館: `config.gym` が存在するセッションの distinct 値。
  - 種別: `resolvePracticeTypeLabel` の distinct 値。
  - 日時: `practiceStartTime` を「その日の 0:00」でまとめた distinct 日。
    ラベルは既存 `formatSessionDate` で `M/D(曜)`。昇順ソート。
- ある軸の distinct 選択肢が **2 未満**（0 or 1）のときは、その軸の行を**描画しない**
  （選べる意味がないため）。
- フィルタ状態はコンポーネントの ephemeral な `useState`（**persist しない**）。
  同期アーキテクチャの「ローカル保持を減らす」方針に沿う。

### フィルタ適用

- `visibleSessions` から派生して `filteredSessions` を `useMemo` で算出。
  - 体育館選択あり: `session.config.gym === selectedGym`
  - 種別選択あり: `resolvePracticeTypeLabel(session) === selectedType`
  - 日時選択あり: `practiceStartTime` の day-start が `selectedDay` と一致
- 一覧の `.map` は `filteredSessions` を使う。

### 0 件時の表示

- `visibleSessions` はあるが `filteredSessions` が 0 件の場合:
  - 「条件に一致するセッションがありません」+ **「フィルタをクリア」** ボタン
    （全フィルタを「すべて」に戻す）を表示。
- `visibleSessions` 自体が 0 件のときは従来通り「アクティブなセッションがありません」。

## UI（DESIGN.md 準拠）

- 各軸: 小さなラベル（体育館 / 種別 / 日時）+ チップ行。
- チップ行は横スクロール可（`overflow-x-auto`、`flex-nowrap`）。「すべて」を先頭に。
- 選択中チップ: `bg-primary text-primary-foreground`、非選択: `bg-muted text-foreground`。
- チップは補助操作なので `py-1.5 px-3 text-xs`（44px 厳守の対象外の補助 UI）。
- タップフィードバック `active:scale-[0.98]`、`transition-colors`。
- レイアウトジャンプ回避のためフィルタバーはカード内に収める。

## 実装方針

- 変更は基本 `SessionSelectPage.tsx` に閉じる。
  チップ描画は同ファイル内のローカル小コンポーネント（例 `FilterChipRow`）に切り出す。
- 選択肢導出（gyms / types / days）は `useMemo`。
- `devMode` 分岐や `isSessionVisible` の既存ロジックは変更しない
  （フィルタは `visibleSessions` の**後段**に乗せるだけ）。

## テスト / 受け入れ

- `npm run build` / `npm run lint` / `npm run test:run` が全て通ること。
- 既存の SessionSelectPage 系テストがあれば壊さない（あれば導出/絞り込みのテストを追加）。
- 手動確認観点:
  - 複数体育館 / 種別 / 日付が混在する一覧で各チップが正しく絞り込む。
  - 単一値しかない軸の行は出ない。
  - 全条件で 0 件になったら空表示 + クリアで復帰。
  - devMode / 非 devMode どちらでも一覧の見え方（90 分前ルール等）は従来通り。
