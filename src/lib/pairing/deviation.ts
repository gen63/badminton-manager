/**
 * 登録レートを「偏差」（当日のロースター内で 平均50・SD10）に直す。
 *
 * 配置の点数（`objective.ts` の `SCORE_TABLE`）はすべてこの偏差の「何点分の悪さか」で
 * 測る。レートの絶対値は会によって違うので、その日の全アクティブメンバー
 * （他コート中を含む）の分布で標準化する。
 *
 * - 偏差 = 50 + 10 × z。z は ±3 で丸める（偏差 20〜80）
 * - レート未設定（0 以下）は平均 = 偏差 50 扱い。平均・SD の母集団にも入れない
 * - 全員同じレート（SD=0）なら全員 50
 */
import type { Player } from '../../types/player';

export const DEVIATION_Z_CLAMP = 3;

export function buildDeviationById(
  players: Pick<Player, 'id' | 'rating'>[]
): Map<string, number> {
  const rated = players.filter(p => (p.rating ?? 0) > 0);
  const out = new Map<string, number>();
  const mean = rated.length ? rated.reduce((s, p) => s + (p.rating ?? 0), 0) / rated.length : 0;
  const variance = rated.length
    ? rated.reduce((s, p) => s + ((p.rating ?? 0) - mean) ** 2, 0) / rated.length
    : 0;
  const sd = Math.sqrt(variance);
  for (const p of players) {
    const r = p.rating ?? 0;
    if (r <= 0 || sd === 0) {
      out.set(p.id, 50);
      continue;
    }
    const z = Math.max(-DEVIATION_Z_CLAMP, Math.min(DEVIATION_Z_CLAMP, (r - mean) / sd));
    out.set(p.id, 50 + 10 * z);
  }
  return out;
}
