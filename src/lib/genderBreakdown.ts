/** 参加者の性別内訳。`unknown` は性別未設定（`gender` が `'M'` / `'F'` 以外）の人数 */
export interface GenderBreakdown {
  total: number;
  male: number;
  female: number;
  unknown: number;
}

/** 内訳の集計に必要な最小フィールドだけを要求（Player 型全体に依存させない） */
interface GenderedPlayer {
  gender?: 'M' | 'F';
}

/**
 * 参加者一覧の性別内訳を集計する。
 *
 * 会計の推定（`AccountingPage`）では性別未設定を男性として扱うが、こちらは
 * 「未設定を見つけて埋める」ための表示なので男性に寄せず `unknown` で分けて返す。
 */
export function countByGender(players: GenderedPlayer[]): GenderBreakdown {
  const male = players.filter((p) => p.gender === 'M').length;
  const female = players.filter((p) => p.gender === 'F').length;
  return {
    total: players.length,
    male,
    female,
    unknown: players.length - male - female,
  };
}

/**
 * 内訳を見出し用の文字列にする（例: `13人：男8・女4・未設定1`）。
 * 未設定が 0 人のときは項目自体を省き、通常時のノイズを減らす。
 */
export function formatGenderBreakdown(breakdown: GenderBreakdown): string {
  const parts = [`男${breakdown.male}`, `女${breakdown.female}`];
  if (breakdown.unknown > 0) parts.push(`未設定${breakdown.unknown}`);
  return `${breakdown.total}人：${parts.join('・')}`;
}

/** カード等に出す性別ラベル。未設定は `未設定` を返す */
export function genderLabel(gender?: 'M' | 'F'): string {
  if (gender === 'M') return '男';
  if (gender === 'F') return '女';
  return '未設定';
}
