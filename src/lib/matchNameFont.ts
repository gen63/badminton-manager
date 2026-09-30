/**
 * 履歴の試合カード: 選手名の行に収まらないときのフォント縮小段階を決める。
 *
 * 幅の見積り（スマホ 390px）:
 *   ページ px-4 (32) + カード p-2 と枠 (18) + 試合番号バッジ列 w-5 + gap-2 (28)
 *   + 編集/削除アイコン列 w-7 + gap-2 (36) = 114 → 中央列 ≒ 276px。
 *   分析列あり: 判定チップ（10px × 最大4文字 + px-1.5 ≒ 52px）+ 列間 gap-x-2 (8) → 中央列 ≒ 216px。
 * 1行目は名前2つの間の gap-1.5 (6px)、2行目はさらに VS ピル
 * （10px×2文字 + px-1.5 ≒ 32px）+ gap-1.5 (6px) を名前の幅から差し引く。
 * 全角の名前は 1文字 ≒ フォントサイズ 1em として扱う。
 */
export const NAME_FONT_SIZES_PX = [14, 12, 11] as const;
export const NAME_ROW_WIDTH_PX = { plain: 276, withInsight: 216 } as const;
const NAME_GAP_PX = 6;
const VS_PILL_PX = 32 + 6;

/** 名前の文字数（サロゲートペア対応）。3文字以下は省略せず、4文字以上は最低3文字＋…を残す。 */
export const NAME_NO_TRUNCATE_MAX_CHARS = 3;

export function nameCharCount(name: string): number {
  return [...name].length;
}

/**
 * その行に並べる名前の文字数合計から、標準 → 1段小さい → 2段小さい（最小 11px）を選ぶ。
 * @param totalChars 行に表示する名前の合計文字数
 * @param opts.hasVsPill 2行目（VS ピルあり）か
 * @param opts.hasInsight 分析列があるか（中央列が狭くなる）
 * @param opts.nameCount 行の名前の数（名前間の gap 計算用）
 */
export function pickNameFontSizePx(
  totalChars: number,
  opts: { hasVsPill: boolean; hasInsight: boolean; nameCount?: number },
): number {
  const row = opts.hasInsight ? NAME_ROW_WIDTH_PX.withInsight : NAME_ROW_WIDTH_PX.plain;
  const nameCount = opts.nameCount ?? 2;
  const fixed = Math.max(0, nameCount - 1) * NAME_GAP_PX + (opts.hasVsPill ? VS_PILL_PX : 0);
  const avail = row - fixed;
  for (const size of NAME_FONT_SIZES_PX) {
    if (totalChars * size <= avail) return size;
  }
  return NAME_FONT_SIZES_PX[NAME_FONT_SIZES_PX.length - 1];
}
