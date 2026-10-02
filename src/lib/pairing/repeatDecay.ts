/**
 * 目的6 `variety`（同じ顔ぶれの繰り返しを嫌う）の入力。減衰付きの共演重みの組み立て。
 * `docs/plans/2026-10-02-variety-decay.md`
 *
 * ## 何を数えるか
 *
 * 過去の各試合について「その試合で同じコートに居た2人」「同じ4人」を数え、
 * **遠い試合ほど軽く**数える。
 *
 * - 試合数減衰: 「その2人（4人）が、その試合の後に平均で何試合したか」を
 *   経過とし、重み = `decay ^ 経過試合数`。他の人が何試合挟まっても関係なく、
 *   本人たちの体感（直近のあの人たちとまた同じ）に沿う。休んでいた人は経過が進まず
 *   記憶が薄れない
 * - 時間減衰（経過分の半減期）も試作したが、強さへの影響は同等で、繰り返しの抑制は
 *   試合数減衰より弱かったので採らなかった（plan 参照）
 *
 * 時刻・順序はすべて **履歴内の値どうしの比較のみ**（`Date.now()` に依存しない）。
 * `matchHistory` は古い順（末尾が最新）。
 *
 * **副作用なし・`algorithm.ts` を import しない**（循環参照防止）。
 */
import type { Match } from '../../types/match';

/** 減衰付き共演重み。キーは `pairKeyOf` / `comboKeyOf` の規則 */
export interface RepeatWeights {
  /** 2人の共演（味方・敵の区別なし）の減衰重み和 */
  pair: Map<string, number>;
  /** 同じ4人（チーム分けは問わない）の減衰重み和 */
  quad: Map<string, number>;
}

/** variety の形。bench が上書きして比較できるよう書き換え可能にしてある */
export const VARIETY_SHAPE = {
  /** 'off' なら従来の variety（その日の累計回数・減衰なし。bench の比較用） */
  mode: 'games' as 'off' | 'games',
  /** 1試合経過するごとの重みの倍率 */
  decay: 0.85,
  /** ペア重みの凸関数の指数。1回目は軽く、重なるほど急に効く */
  power: 2.5,
  /** コートのペア項 x を min(1, x/scale) で 0〜1 に写す（scale に達すると頭打ち） */
  scale: 6,
  /** 同じ4人の重み和（上限2）にかける係数。ペア項とは別枠で足す */
  quadWeight: 0.5,
  /** 減衰しない累計（その日全体の回数）を足す係数。0 なら完全に減衰のみ */
  rawFloor: 0.2,
};

export function buildRepeatWeights(
  matchHistory: Match[],
  pairKeyOf: (a: string, b: string) => string,
  comboKeyOf: (ids: readonly string[]) => string,
  shape: Pick<typeof VARIETY_SHAPE, 'mode' | 'decay'> = VARIETY_SHAPE
): RepeatWeights {
  const pair = new Map<string, number>();
  const quad = new Map<string, number>();
  if (shape.mode === 'off' || matchHistory.length === 0) return { pair, quad };

  // 各人の出場通番（1始まり）と総出場数 → 「その試合の後の出場数」
  const ordinal: number[][] = [];
  const total = new Map<string, number>();
  for (const m of matchHistory) {
    const ids = [...m.teamA, ...m.teamB];
    ordinal.push(ids.map(id => {
      if (!id) return 0;
      const k = (total.get(id) ?? 0) + 1;
      total.set(id, k);
      return k;
    }));
  }

  const add = (map: Map<string, number>, key: string, w: number) =>
    map.set(key, (map.get(key) ?? 0) + w);

  matchHistory.forEach((m, idx) => {
    const ids = [...m.teamA, ...m.teamB];
    if (ids.some(id => !id)) return; // シングルス等の空きスロットは対象外
    const since = ids.map((id, i) => total.get(id)! - ordinal[idx][i]);
    const wAll = Math.pow(shape.decay, since.reduce((a, b) => a + b, 0) / 4);
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        add(pair, pairKeyOf(ids[i], ids[j]), Math.pow(shape.decay, (since[i] + since[j]) / 2));
      }
    }
    add(quad, comboKeyOf(ids), wAll);
  });
  return { pair, quad };
}
