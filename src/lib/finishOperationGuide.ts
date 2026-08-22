/**
 * 「待機場所」ガイドの判定
 *
 * 「気づいた人が終了操作をする」運用を「次の試合に入るメンバー（配置予測の
 * ほぼ確定＝濃い青）が操作する」運用へ変えるための案内。担当に期待するのは
 * 終了ボタンだけでなく **終了 → 配置 → 開始** の一連だが、役割（操作担当）は
 * 配置予測バー（`NextMatchPredictionBar`）の見出しが常時示しているので、
 * このガイドが言うのは **どのコート付近で待てばいいか** だけにする。
 *
 * **プレイ中コートがある間は常時出す**。待機場所は 4:30 を待たなくても分かる
 * （最も経過が長いコートが最も早く終わる見込み）ので、あらかじめそこで待てる
 * ことに実利があるため。ただし開始時刻が近いコートが3面以上あると
 * 「①②③で待機」は場所を絞れておらず無意味なので、その場合と1面運用では
 * 番号を落として `コート付近待機` にする。
 *
 * 2段階で見た目を変える:
 *   - `waiting`: 4:30 未満。控えめな1行（まだ先の話）。
 *   - `imminent`: 経過最大のコートが 4:30 を超えた。オレンジで強調する
 *     （同じ閾値でコートカードの外枠も太くなるので見た目が連動する）。
 *
 * 4:30 の呼び出し通知（`nextMatchCall.ts`）は OS 通知・チャイム・読み上げで
 * 「画面を見ていない人に気づかせる」役割、こちらは画面上に出続けて
 * 「いつでも確認できる」役割で補完する。
 *
 * 判定に必要な「経過最大のプレイ中コート」は `nextMatchCall.ts` の
 * `maxPlayingCourt` / `maxPlayingElapsedMs` をそのまま再利用する。
 * 詳細: docs/plans/2026-08-18-finish-operation-guide.md /
 * docs/plans/2026-08-22-standby-guide-always-on.md
 */

import type { Court } from '../types/court';
import { MATCH_CALL_THRESHOLD_MS } from './gameOperations';
import { maxPlayingCourt, maxPlayingElapsedMs } from './nextMatchCall';

/**
 * 「ほぼ同時に始まった」とみなす経過時間の差（60秒）。
 * これ以内なら終わる順番が読めないので、どちらのコート付近で待つべきかを
 * 1面に絞らず両方を案内する。
 */
export const STANDBY_CLOSE_START_MS = 60 * 1000;

/**
 * 待機場所として案内できるコート数の上限（2面）。
 * 「①②の間」なら立ち位置を決められるが、3面以上を並べても体育館の中央を
 * 指すのと変わらず場所の案内にならないため、超えたら番号を出さない。
 */
export const STANDBY_MAX_COURTS = 2;

/**
 * ガイドの段階。
 * - `waiting`: プレイ中だがまだ 4:30 未満（そろそろ、ではない）
 * - `imminent`: 経過最大のコートが 4:30 を超えた（もうすぐ終わる）
 */
export type FinishGuidePhase = 'waiting' | 'imminent';

export interface FinishOperationGuide {
  phase: FinishGuidePhase;
  /**
   * 待機場所として案内するコートの ID（`id` 昇順）。
   * 場所を絞れないとき（近接コートが `STANDBY_MAX_COURTS` を超える）と
   * 1面運用（`showCourtNumber === false`）では空配列。
   */
  courtIds: number[];
  /** 操作の担当（`certainIds` のうちまだコートに乗っていない人） */
  playerIds: string[];
}

export interface FinishOperationGuideArgs {
  courts: Court[];
  /** 配置予測の「ほぼ確定」メンバー（候補 likelyIds は対象外） */
  certainIds: Set<string>;
  now: number;
  /** コート番号を出すか。呼び出し側が `courts.length > 1` で判断する */
  showCourtNumber: boolean;
}

/** コートに乗っているか（配置済み・プレイ中を問わない） */
function isOnAnyCourt(courts: Court[], playerId: string): boolean {
  return courts.some((c) => c.teamA.includes(playerId) || c.teamB.includes(playerId));
}

/**
 * 待機場所として案内するコート ID を求める（`id` 昇順）。場所を絞れなければ空配列。
 *
 * 経過が最大＝最も早く終わりそうなコートを起点に、そこから
 * `STANDBY_CLOSE_START_MS` 以内で始まったプレイ中コートをまとめる。3面同時開始の
 * ように候補が `STANDBY_MAX_COURTS` を超えたら、どこで待っても同じなので空配列。
 *
 * `callBasisCourtId` を使わないのは意図的。あちらは「次に配置される先」なので
 * 空きコートを優先するが、ここで欲しいのは「終了操作の対象＝もうすぐ終わる
 * プレイ中コート」で別物。
 */
export function standbyCourtIds(courts: Court[], now: number): number[] {
  const maxElapsed = maxPlayingElapsedMs(courts, now);
  if (maxPlayingCourt(courts, now) === null) return [];

  const ids = courts
    .filter((c) => c.isPlaying && c.startedAt > 0)
    .filter((c) => maxElapsed - (now - c.startedAt) <= STANDBY_CLOSE_START_MS)
    .map((c) => c.id)
    .sort((a, b) => a - b);

  return ids.length > STANDBY_MAX_COURTS ? [] : ids;
}

/**
 * 表示すべきガイドを組み立てる。出す必要が無ければ null。
 */
export function buildFinishOperationGuide(
  args: FinishOperationGuideArgs,
): FinishOperationGuide | null {
  const { courts, certainIds, now, showCourtNumber } = args;

  if (maxPlayingCourt(courts, now) === null) return null;

  // 既にコートに乗っている人は促す相手にならない（`shouldAnnounceToAdmin` の
  // allOnCourt 条件と同じ考え方）。全員乗っていれば出す意味が無い。
  const playerIds = Array.from(certainIds).filter((id) => !isOnAnyCourt(courts, id));
  if (playerIds.length === 0) return null;

  const imminent = maxPlayingElapsedMs(courts, now) >= MATCH_CALL_THRESHOLD_MS;

  return {
    phase: imminent ? 'imminent' : 'waiting',
    courtIds: showCourtNumber ? standbyCourtIds(courts, now) : [],
    playerIds,
  };
}

/**
 * コート番号の丸数字表記（1 → `①`）。コートカードのヘッダーが番号を丸バッジで
 * 出しているので、丸数字だけで「どのコートか」は十分伝わり、`コート` の3文字を
 * 省ける。Unicode に丸数字がある 1〜20 の範囲外は素の数字＋`コート` に戻す。
 */
function circledCourt(courtId: number): string {
  if (!Number.isInteger(courtId) || courtId < 1 || courtId > 20) return `${courtId}コート`;
  return String.fromCharCode(0x2460 + courtId - 1);
}

/**
 * ガイドの見出し文言。名前は表示側がチップで描くのでここには含めない。
 *
 * **どこで待つか**だけを言う。「操作担当」であることは配置予測バーの見出し
 * （`配置予測（操作担当）`）が常時示しているので、ここで繰り返さない。
 * 「付近」は呼び出し通知（`Nコート付近で試合終了をお待ちください`）と同じ語彙。
 *
 * 複数コートは区切り無しで連結する（`①②付近待機`）。丸数字は1文字ずつ独立して
 * 読めるので中黒を挟まなくても誤読せず、390px 幅でも名前チップと1行に収まる。
 */
export function buildFinishOperationGuideHeadline(guide: FinishOperationGuide): string {
  if (guide.courtIds.length === 0) return 'コート付近待機';
  return `${guide.courtIds.map(circledCourt).join('')}付近待機`;
}

/**
 * `waiting` から `imminent` に変わるまで（4:30 に達するまで）の待ち時間（ms）。
 * 既に 4:30 を超えている、またはプレイ中コートが無ければ null（タイマー不要）。
 * 毎秒 tick する代わりに閾値ちょうどで1回だけ再評価させるために使う
 * （`courtEmphasis.ts` の `getNextCourtEmphasisDelay` と同じ考え方）。
 *
 * 待機場所（`standbyCourtIds`）は経過時間の差で決まり、差は時間が経っても
 * 変わらないため、段階の切り替え以外に再評価のきっかけは要らない。
 */
export function getNextFinishGuideDelay(courts: Court[], now: number): number | null {
  const court = maxPlayingCourt(courts, now);
  if (court === null) return null;
  const elapsed = now - court.startedAt;
  if (elapsed >= MATCH_CALL_THRESHOLD_MS) return null;
  return MATCH_CALL_THRESHOLD_MS - elapsed;
}

export interface CanFinishGameArgs {
  /** `useSessionStore.isAdmin()`（作成者 / 管理権限 / 開発モードを含む） */
  isAdmin: boolean;
  /** 配置予測の「ほぼ確定」メンバー＝操作担当（候補 likelyIds は対象外） */
  certainIds: Set<string>;
  /** 自分の Player ID。特定できないときは null */
  myPlayerId: string | null;
}

/**
 * 試合終了ボタンを押してよいかを判定する。
 *
 * 「気づいた人が終了操作をする」運用をやめ、管理者か操作担当に寄せるための
 * UX ガード。認証境界ではない（CLAUDE.md の信頼モデル通り、`currentUser` は
 * localStorage の単なる文字列で改変できる）。
 *
 * **担当が 1 人も居ないときは全員に開放する**（フォールバック）。待機者が定員に
 * 満たない練習終盤や、配置が成立せず予測不能（`scenarioCount === 0`）のときは
 * `certainIds` が空になり得るため、そのまま絞ると管理者以外は誰も試合を終われず
 * 運用が止まってしまう。
 */
export function canFinishGame({ isAdmin, certainIds, myPlayerId }: CanFinishGameArgs): boolean {
  if (isAdmin) return true;
  if (certainIds.size === 0) return true;
  return myPlayerId !== null && certainIds.has(myPlayerId);
}

/**
 * 権限が無い人が終了ボタンをタップしたときのアナウンス文言。
 *
 * 「押せない」だけだと**誰が押すのか**が分からず、待つ人が動けない。配置予測バーの
 * 濃い青（＝操作担当）を名指しして、次に何が起きるかまで言い切る。
 * 名前は `predictedPlayers` と同じ「入りやすい順」で渡す想定。
 *
 * 担当が 1 人も居ないときは `canFinishGame` が全員に開放するのでこの文言は出ない
 * （保険として管理者運用の説明を返す）。
 */
export function buildFinishBlockedMessage(operatorNames: string[]): string {
  if (operatorNames.length === 0) return '終了操作は管理者と操作担当のみできます';
  const names = operatorNames.map((name) => `${name}さん`).join('・');
  return `濃い青の${names}が担当です。押せません`;
}
