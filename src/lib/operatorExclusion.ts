/**
 * 名前に「外部」を含むメンバー（外部参加者）向けの作成時の初期値。
 * - 終了操作の担当外（`defaultExcludeFromOperator`）
 * - 到着調整「遅刻救済 0」（`defaultArrivalAdjustment`）
 * どちらもオートセッション作成・セッション作成画面・参加者追加（`computeAddPlayers`）で付ける。
 * 参加登録（`joinSession`）はどちらも付けない（既存の扱いに合わせる）。
 *
 * 依存を持たない純粋関数。`scripts/auto-create-session.ts`（Node/tsx 直実行で
 * Firebase 初期化を import できない）からも安全に参照できるよう独立させている。
 * 詳細: docs/plans/2026-09-30-operator-exclusion.md /
 *       docs/plans/2026-10-05-external-arrival-earliest.md
 */

import type { ArrivalAdjustment } from '../types/player';

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

/**
 * プレイヤー作成時の到着調整（`arrivalAdjustment`）の初期値。名前に「外部」を含むなら
 * 遅刻救済「0」（`{ kind: 'ratio', ratio: 0 }`＝受付完了がいつでも練習開始から居たとみなす）、
 * それ以外は undefined。外部の人は早く着いても名簿・支払い（PayPay 送金の案内など）で受付完了が
 * 遅れがちなので、本人の責任ではない分まで滞在が短くならないようにする。
 * 作成時の初期値にすぎず、管理者が参加者編集で解除・変更できる。会費・名簿が未完了の間は従来どおり滞在0。
 */
export function defaultArrivalAdjustment(name: string): ArrivalAdjustment | undefined {
  return name.includes(OPERATOR_EXCLUDED_NAME_MARKER) ? { kind: 'ratio', ratio: 0 } : undefined;
}
