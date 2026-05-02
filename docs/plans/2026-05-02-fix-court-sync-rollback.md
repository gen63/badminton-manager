# 他メンバー同期で配置済みコートが巻き戻る不具合の修正

## Context（背景）

ユーザー報告:
> 他メンバーの同期でコート情報が巻き戻る。配置がされていないことになる。

A が配置したコートが、B 側の操作後の同期で **空に戻り**、配置自体が無かった
ことになる症状。`2026-05-02-fix-sync-duplicates.md` で導入した
`dedupPlayersAcrossCourts` の優先度が、**ローカル変更を最優先で残す** 仕様
だったため、別クライアントが先に push した authoritative な配置（remote）の
方を空にしてしまっていた。

## 再現シナリオ

1. T0: 全員 court1=空、court2=空。p1..p4 が待機リスト。
2. A が「コート1に一括配置」を実行 → A の local: court1=[p1..p4]、push。
   Firestore: `court1=[p1..p4]`。
3. B が（A の push をまだ受けていない状態で）「コート2に一括配置」を実行 →
   同じ待機リストから p1..p4 を引いて B の local: court2=[p1..p4]。
4. B が onSnapshot で A の push を受信:
   - base: court1=空, court2=空
   - local: court1=空, court2=[p1..p4]
   - remote: court1=[p1..p4], court2=空
   - `mergeCourt` の結果: court1=[p1..p4]（remote 採用）、
     court2=[p1..p4]（local 採用）。**両コートに同じ p1..p4 が出現**。
5. `dedupPlayersAcrossCourts`:
   - 現行優先度 「localChangedTeams が変更されたコートを残す」
     → court2 を残し court1 のスロットを空にする。
   - B の merged: court1=空, court2=[p1..p4]。
6. B が次の操作で push → Firestore: `court1=空, court2=[p1..p4]`。
7. A が B の push を受信:
   - base: court1=[p1..p4], court2=空
   - local: court1=[p1..p4], court2=空
   - remote: court1=空, court2=[p1..p4]
   - `mergeCourt` court1: 各位置で `l===b='p1' → remote ''` を採用 → **空**。
   - **A 側でも court1 が空に巻き戻る**。配置がなかったことになる。

## 根本原因

`src/lib/syncUtils.ts` の `dedupPlayersAcrossCourts` の優先度:

```
1. isPlaying のコート（試合中ロック）
2. localChangedTeams のコート（直近のローカル操作）   ← ここが問題
3. court.id 小さい方
```

「localChangedTeams 優先」は、**「自分の操作を見せる」** ことを意図したもの
だったが、これは「自分が知らずに別クライアントの authoritative な配置と衝突
した」場合に、他者の prior write を無効化してしまう。重複が発生する典型ケース
は B が A の push を見ていない状態で同じプレイヤーを別コートに乗せてしまった
シナリオであり、この場合 **先に Firestore に書かれた remote 側の配置を
尊重するのが正しい**。

## 修正方針

`dedupPlayersAcrossCourts` の優先度を変更し、**位置粒度で「remote-sourced」
（remote が値を提供した位置）を「local-sourced」より優先** する。

### 位置粒度の source 判定

各 `(courtId, team, index)` で、`base[i]` と `local[i]` を比較して
出所を判定する（`mergeTeam` の挙動と整合）:

- `local[i] !== base[i]` → 結果値は `local[i]`（local-sourced）
- `local[i] === base[i]` → 結果値は `remote[i]`（remote-sourced。
  base と一致する「stable」も含めて remote 扱い）

### 新優先度

```
1. isPlaying のコート（試合中ロック）
2. remote-sourced の位置（他クライアントの authoritative 配置）   ← 変更
3. local-sourced の位置
4. court.id 小さい方
```

これにより、同時並列配置で発生する重複は **先に push した側を残す**
ことになり、A 視点での巻き戻りが消える。B 側では「自分の配置が見えない」
状態になるが、これは他者の prior write を尊重した正しい挙動であり、
ユーザは再配置できる。

## 修正対象ファイル

- `src/lib/syncUtils.ts`
  - `dedupPlayersAcrossCourts`: 出現位置に source（'remote' | 'local'）を
    保持し、優先度判定で source を使うようリファクタ。
  - `mergeCourts` から `localMap` を渡している経路は維持。
- `src/lib/syncUtils.test.ts`
  - 既存テスト「異なるコートに同じプレイヤー配置 → 重複を解消（local 配置を
    残す）」: 期待値を「remote 配置を残す」に変更（仕様変更）。
  - 新規テスト「他メンバーが先に配置済みのコートが、未認識の並行配置 dedup
    で空に巻き戻らない」: 本 bug の再現と修正確認。
  - 既存テスト「試合中コートと準備中コートに同じプレイヤー → 試合中側を保持」:
    isPlaying 優先度は最上位なので影響なし、引き続き通る。

## 検証

```bash
npm run build
npm run lint
npm run test:run
```

### 手動検証
2 タブで同セッションを開き、
1. 両タブで違うコートに「コート別一括配置」を素早く順番に実行 →
   先に押したタブの配置が両者で残ること（後押しタブの配置は空になる）。
2. 既存の試合中コート保護シナリオが引き続き動くこと。
