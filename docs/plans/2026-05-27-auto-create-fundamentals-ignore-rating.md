# 2026-05-27 「基礎」練習はレート（序列）未設定でも自動作成を進める

## 背景

`scripts/auto-create-session.ts` の `processEvents` は、参加者に序列（=レート）が
未設定の場合 `checkPlayerIssues` が `序列未設定` の issue を返し、`FORCE_CREATE`
が無効ならセッションを作成せず保留（`notifySessionPending`）にする
（scripts/auto-create-session.ts:674-687）。

レートは初期序列ソート（`buildInitialOrder`）と組み合わせコスト計算にしか使われず、
未設定でもマッチング自体は成立する（未設定は 1500 にフォールバック）。

「基礎」と名のつく練習（E-tomo タイトル例: `@富士見台.楽基礎`）は初級者向けで、
そもそも序列が付いていない参加者が多い。これらはレート有無に関わらず作成を
進めたい、というのが要望。

なお `parseEventTitle` は `楽` で始まる note を `楽` に正規化するため
（2026-05-20-normalize-raku-note.md）、正規化後の `note` からは「基礎」かどうか
判別できない。正規化前の `rawNote` で判定する必要がある。

## 方針

`parseEventTitle` で正規化前の `rawNote` に `基礎` が含まれるかを判定し、
`isBasic` フラグとして `EtomoEvent` まで伝播させる。`processEvents` で
`event.isBasic` が真なら、`FORCE_CREATE` 同様に issue があっても作成を続行する。

- 判定は `rawNote.includes('基礎')`。`楽基礎` も単独 `基礎` もカバーする。
- **単独「基礎」の practiceType も `楽` に正規化する**（ユーザー確認済み 2026-05-28）。
  `楽基礎` は従来から `楽` だったが、単独 `基礎` は正規化対象外で型外の値
  （`'単'|'複'|'楽'` 以外）になっていた。`楽` 始まり OR `基礎` を含む note は
  `楽` に正規化することで、並び順（多様性優先）・表示を `楽基礎` と統一する。
- `isBasic` は `EtomoEvent` のオプショナル項目とし、`parseEventList` が常に設定。
  既存のテスト用 fixture（手書き literal）は省略可。

### 実装

1. `EtomoEvent` に `isBasic?: boolean` を追加。
2. `parseEventTitle` で `isBasic = rawNote.includes('基礎')` を算出し、戻り値に追加。
   さらに `note` の正規化を `rawNote.startsWith('楽') || isBasic ? '楽' : rawNote`
   に拡張（単独「基礎」も `楽` 扱い）。
3. `parseEventList` の push に `isBasic: parsed.isBasic` を追加。
   （`fetchEventDetails` は `...event` で `EtomoEventDetail` に伝播するため変更不要）
4. `processEvents` の保留判定を
   `if (!forceCreate && !event.isBasic)` に変更。基礎練習は作成を続行し、
   ログにその旨を出す。

### テスト

`scripts/auto-create-session.test.ts`:

- `parseEventTitle` の `toEqual` 期待値に `isBasic` を追加（既存ケースは `false`）。
- `@富士見台.楽基礎` → `note: '楽'`, `isBasic: true` を確認。
- `@富士見台.基礎`（単独）→ `note: '楽'`, `isBasic: true` を確認。
- `parseEventList` の `toEqual` 期待値に `isBasic: false` を追加。
