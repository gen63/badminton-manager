# 練習種別「楽」で配置タイミングUIがシングル扱いになる不具合の修正

作成日: 2026-05-03
対応ブランチ: `claude/fix-doubles-practice-mode-aP4Ps`

## 不具合

`SessionCreate.tsx` / `SettingsPage.tsx` の「配置タイミング」UI（多様性優先 / 回数優先）
が、練習種別 `楽` のときも `prioritizeDiversity` の値次第で「回数優先」が
ハイライトされた状態（`単` モードのロック後と同じ見た目）になる。

ユーザーの期待: `楽` は「ダブルス（多様性優先）に固定」されてほしい。

### 再現シナリオ

1. 練習種別を `単` に切替: `setPracticeType('単')` と同時に `setPrioritizeDiversity(false)` が呼ばれ、
   配置タイミングは `回数優先` に固定（ボタン無効化）。
2. 続けて `楽` に切替: `setPracticeType('楽')` のみが呼ばれる。
   `prioritizeDiversity` は `false` のまま残り、`isSinglesMode` は `false` になるので
   ボタンは有効化されるが、`回数優先` がハイライトされたまま。

加えて、`useSettingsStore` のデフォルトは `prioritizeDiversity: false` のため、
新規ユーザーが最初から `楽` を選んだケースでも初期値で `回数優先` が見えてしまう。

## 根本原因

- `練習種別` ボタンの `onClick` は `単` のときだけ `prioritizeDiversity` を強制 false にする。
  `楽` / `複` への切替時はリセットがない。
- `配置タイミング` UI は `isSinglesMode = practiceType === '単'` でしか
  ロックを判定していないため、`楽` は `複` と区別なく「ユーザー任意のダブルスモード」扱い。

ユーザーの意図では `楽` はカジュアルなダブルス専用で、配置タイミングも
多様性優先に固定したい（思考停止で使いたい）。

## 修正方針

`楽` を「多様性優先固定のダブルスモード」として扱う。`単` の鏡像になる。

| 練習種別 | ゲームモード | 配置タイミング |
|----------|--------------|----------------|
| 単       | singles      | 回数優先 固定（ボタン無効） |
| 複       | doubles      | ユーザー任意（多様性 / 回数） |
| 楽       | doubles      | **多様性優先 固定（ボタン無効）** |

### 実装

`SessionCreate.tsx` と `SettingsPage.tsx` の両方に同じ変更を入れる。

1. **練習種別ボタンの `onClick`**:
   ```ts
   onClick={() => {
     setPracticeType(type);
     if (type === '単') setPrioritizeDiversity(false);
     if (type === '楽') setPrioritizeDiversity(true);
   }}
   ```
   `楽` 選択時に `prioritizeDiversity` を強制 true にする。
   これで「単→楽」切替時も初期状態（`楽` 初回選択時）も多様性優先が選ばれる。

2. **配置タイミングUIのロック判定を拡張**:
   ```ts
   const isSinglesMode = practiceType === '単';
   const isRelaxedMode = practiceType === '楽';
   const isLocked = isSinglesMode || isRelaxedMode;
   ```
   `disabled={isLocked}`、`opacity-50 cursor-not-allowed` も `isLocked` に統一。

3. **アクティブ表示の判定**:
   - 多様性優先ボタン: `isRelaxedMode || (!isSinglesMode && prioritizeDiversity)` でアクティブ
   - 回数優先ボタン: `isSinglesMode || (!isRelaxedMode && !prioritizeDiversity)` でアクティブ

4. **説明文**:
   ```ts
   {isSinglesMode
     ? 'シングルスでは回数優先が適用されます'
     : isRelaxedMode
     ? '楽では多様性優先が適用されます'
     : prioritizeDiversity
     ? '組み合わせの多様性を優先（余り人数が少ない時は一括配置を推奨）'
     : '空きが出たら即座に配置'}
   ```

## 非対象

- `useSettingsStore` のデフォルト値 (`prioritizeDiversity: false`) は変更しない。
  `楽` を選んだときの強制 set でカバーできるため。
- `複` の挙動は変更しない（既存通りユーザー任意）。
- `MainPage.tsx` 側の `gameMode` ロジックは変更不要（`楽` は既に `doubles` を返す）。

## 動作確認

- `npm run build` / `npm run lint` / `npm run test:run` がすべて通ること
- `単` → `楽` 切替直後、配置タイミングが「多様性優先」にハイライトされ、
  ボタンが無効化されること
- `楽` を初めて選んだとき（`prioritizeDiversity` が `false` の初期状態）、
  「多様性優先」が選択された状態で表示されること
- `楽` → `複` に切替えると、多様性優先のままでボタンが有効化されること
  （ユーザーが任意に変更できる）
- `複` → `楽` 切替時も多様性優先に固定されること
