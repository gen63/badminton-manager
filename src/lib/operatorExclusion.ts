/**
 * 終了操作の担当外の初期値。
 *
 * 依存を持たない純粋関数。`scripts/auto-create-session.ts`（Node/tsx 直実行で
 * Firebase 初期化を import できない）からも安全に参照できるよう独立させている。
 * 詳細: docs/plans/2026-09-30-operator-exclusion.md
 */

/** 担当外を初期値にする名前の目印（初参加の外部メンバーには難易度が高いため） */
const OPERATOR_EXCLUDED_NAME_MARKER = '外部';

/**
 * プレイヤー作成時の `excludeFromOperator` 初期値。名前に「外部」を含む
 * （`【外部】はなこ` 等）なら true、それ以外は undefined（= 担当）。
 * 作成時の初期値にすぎず、後から管理者が参加者編集で変更できる。
 */
export function defaultExcludeFromOperator(name: string): true | undefined {
  return name.includes(OPERATOR_EXCLUDED_NAME_MARKER) ? true : undefined;
}
