# settingsStore の persist 対象を端末ローカル設定だけに絞る (Phase A)

作成日: 2026-05-06
対応ブランチ: `claude/fix-doubles-player-display-mEvx6`

## 背景

`docs/plans/2026-05-06-fix-doubles-player-display.md` で見つかった「ダブルス
なのにコートに 2 人しか配置されない」不具合の根本原因は、
`settingsStore.practiceType` が端末 localStorage に persist されていたため
**前セッションから持ち越して別セッションを汚す** ことだった。

その時の修正は `useFirebaseSync` 側で「`gameState.settings.practiceType` が
未定義なら `'複'` にフォールバック」する **対症療法** で、ローカル persist
自体は残していた。

ユーザー方針:
> ローカルの情報は限りなく使わない・残さない方向にしたい

これに沿って、`settingsStore` の persist 対象を **「Firestore に同期しない
端末ローカル設定」だけ** に絞る。

## 修正方針

### `settingsStore` のフィールドを 2 種類に分類

| field | 同期 | persist 対象 |
|---|---|---|
| `gasWebAppUrl` | × 端末ローカル | ⭕ |
| `accountingWebAppUrl` | × 端末ローカル | ⭕ |
| `useStayDurationPriority` | × 端末ローカルのクセ | ⭕ |
| `prioritizeDiversity` | × 端末ローカル（'単'/'楽' で派生矯正） | ⭕ |
| **`practiceType`** | **⭕ Firestore 同期** | ❌ |
| **`continuousMatchMode`** | **⭕ Firestore 同期** | ❌ |
| **`recordScores`** | **⭕ Firestore 同期** | ❌ |

### `partialize` で persist 対象を絞る

```ts
partialize: (state) => ({
  gasWebAppUrl: state.gasWebAppUrl,
  accountingWebAppUrl: state.accountingWebAppUrl,
  useStayDurationPriority: state.useStayDurationPriority,
  prioritizeDiversity: state.prioritizeDiversity,
  // practiceType / continuousMatchMode / recordScores は persist しない
}),
```

### `version: 1` の `migrate` で旧データを剥がす

既存ユーザーの localStorage には旧 version の同期対象が残っているため、
`version: 1` を立てて migrate で剥がす。

```ts
version: 1,
migrate: (persisted, version) => {
  if (version < 1 && persisted && typeof persisted === 'object') {
    const { practiceType, continuousMatchMode, recordScores, ...rest } =
      persisted as Record<string, unknown>;
    return rest;
  }
  return persisted;
},
```

## 期待される挙動

- アプリ起動 → `settingsStore` 初期化（同期 3 フィールドはコード初期値）
- `useFirebaseSync` の onSnapshot 受信 → 同期 3 フィールドが Firestore の値で
  上書きされる（既存挙動）
- セッション切替 → 新セッション参加時に同期 3 フィールドは Firestore の値で
  上書きされる（drift しない）
- `useFirebaseSync` の practiceType フォールバック (`config.gameMode` →
  `'複'`) は **保険として残す**。`gameState.settings.practiceType` が無い
  legacy セッションで端末側のコード初期値 `'複'` が使われる（singles の旧
  セッションは `config.gameMode === 'singles'` 経由で `'単'` になる）。

## SessionCreate への影響

`SessionCreate.tsx` は `useSettingsStore.getState().practiceType` を読んで新
セッションの初期値にしている。Phase A 後は **アプリ起動時には常に `'複'`
（コード初期値）** からスタートし、ユーザーが画面で `'単'` / `'楽'` を選んだ
時のみその値が新セッションに反映される。

ユーザー方針「ローカルに残さない」と整合。前回作ったセッションの種別を
覚えておく動作は失う（許容）。

## 動作確認

- `npm run build` / `npm run lint` / `npm run test:run` がすべて通る
- `settingsStore.test.ts` に追加した 2 ケース:
  - persist 後の localStorage に同期 3 フィールドが含まれない
  - `migrate(version 0)` で旧 persisted state から同期 3 フィールドが剥がれる

## 非対象

- **Phase B**: `accountingStore` (`records`) の persist 撤廃。会計入力中バッファ
  を Firestore (`session.accounting`) に集約する設計変更が必要なため別 plan。
- **Phase C**: `sessionStore` (`session` + `currentUser`) の persist 最小化。
  リロード復帰 UX への影響が大きいため別 plan で要相談。
