# 2026-05-20 「楽基礎」など `楽` で始まる note を `楽` として認識させる

## 背景

E-tomo のイベントタイトルから抽出される `note`（`@<venue>.<note>` の最後のドット
以降）は、現状そのまま `EtomoEvent.note` に格納される。`scripts/auto-create-session.ts`
は以下の場所で `note` の値を `'単' | '複' | '楽'` のいずれかと厳密一致で比較している:

- `buildSessionData` の `gameMode = event.note === '単' ? 'singles' : 'doubles'`
  （scripts/auto-create-session.ts:466）
- `settings.practiceType = event.note as '単' | '複' | '楽'`
  （scripts/auto-create-session.ts:497）
- `formatEventSummary` の `noteLabel`（scripts/auto-create-session.ts:545）

このため、たとえば `6/8(月)18:30～21:30@富士見台.楽基礎` のように `楽` の後ろに
細分類を付けたタイトルが流れてくると、`note='楽基礎'` となり `楽` として
認識されない。`isPracticeEvent` は `周知`/`協議会` のみ除外するため「直近予定」
には含まれるが、`practiceType` が `'楽基礎'`（型不正な文字列）となり、`gameMode`
は `doubles` にフォールバックする。

## 方針

`parseEventTitle` で `note` を抽出した直後に、**`楽` で始まる note は `楽` に
正規化する**。

- スコープは `楽` のみ（ユーザー確認済み）。`単`/`複` の派生表記は現時点で
  実例がないため厳密一致のまま据え置く。必要になったら別 plan で拡張する。
- `周知`/`協議会` は `楽` で始まらないため影響なし。
- `EtomoEvent.title`（元タイトル）はそのまま保持されるので、デバッグ・ログ用途
  の情報は失わない。

### 実装

`scripts/auto-create-session.ts:107-114` の戻り値で、`note` を以下のように加工:

```ts
const rawNote = dotIndex >= 0 ? venueNote.substring(dotIndex + 1) : '';
const note = rawNote.startsWith('楽') ? '楽' : rawNote;
```

### テスト

`scripts/auto-create-session.test.ts` の `parseEventTitle` ブロックに、

- `@富士見台.楽基礎` → `note: '楽'`

のケースを追加する。
