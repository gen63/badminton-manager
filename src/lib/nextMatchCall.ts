/**
 * 「次の試合に入りそう」事前呼び出し通知の判定
 *
 * MainPage から副作用（Notification / トースト送出）を切り離し、いつ呼び出すべきかの
 * 判定だけを純粋関数として持つ。プレイ中コートのうち経過時間が最大のコートを
 * 基準にする（それが最初に終わる可能性が最も高いコートだから）。`certainIds` は
 * `nextMatchPrediction` の「ほぼ確定」メンバーで、どのコートが終わっても選ばれる
 * ため、基準コートが実際にどれになっても呼ぶ相手は変わらない。
 */

import type { Court } from '../types/court';
import { MATCH_CALL_THRESHOLD_MS, MATCH_CALL_COOLDOWN_MS } from './gameOperations';

/** プレイ中コートの経過時間の最大値（ms）。プレイ中のコートが無ければ 0 */
export function maxPlayingElapsedMs(courts: Court[], now: number): number {
  let max = 0;
  for (const c of courts) {
    if (!c.isPlaying || c.startedAt <= 0) continue;
    const elapsed = now - c.startedAt;
    if (elapsed > max) max = elapsed;
  }
  return max;
}

export interface NextMatchCallArgs {
  courts: Court[];
  /** 配置予測の「ほぼ確定」メンバー（候補 likelyIds は対象外） */
  certainIds: Set<string>;
  /** 自分の Player ID。特定できないときは null */
  myPlayerId: string | null;
  now: number;
  /** すでに呼び出し済みか */
  alreadyCalled: boolean;
  /** 自分が最後にコートに乗っていた時刻。一度も乗っていなければ null */
  lastOnCourtAt: number | null;
}

/** 次の試合に入りそうなメンバーへの事前呼び出し通知を出すべきか判定する */
export function shouldCallNextMatch(args: NextMatchCallArgs): boolean {
  const { courts, certainIds, myPlayerId, now, alreadyCalled, lastOnCourtAt } = args;

  if (myPlayerId === null) return false;
  if (alreadyCalled) return false;
  if (!certainIds.has(myPlayerId)) return false;

  const onAnyCourt = courts.some(
    (c) => c.teamA.includes(myPlayerId) || c.teamB.includes(myPlayerId),
  );
  if (onAnyCourt) return false;

  if (lastOnCourtAt !== null && now - lastOnCourtAt < MATCH_CALL_COOLDOWN_MS) return false;

  return maxPlayingElapsedMs(courts, now) >= MATCH_CALL_THRESHOLD_MS;
}

/**
 * 呼び出しの基準にするコート ID を決める。決められなければ null。
 *
 * `certainIds`（`nextMatchPrediction` の「ほぼ確定」メンバー）は本来どのコートが
 * 終わっても選ばれるため特定コートに紐づかないが、実用上「先に空きそうなコート」を
 * 案内する価値がある。基準は `predictNextMatchPlayers` のシナリオ構成と同じ考え方に
 * 揃えている: 空きコートがあればそれが次の配置対象（最小 ID を採用）、無ければ
 * 最も早く終わりそうな＝経過時間が最大のプレイ中コートを採用する。
 */
export function callBasisCourtId(courts: Court[], now: number): number | null {
  // predictNextMatchPlayers と完全に同じ「空き」判定式
  const emptyCourts = courts.filter((c) => !c.teamA[0] || c.teamA[0] === '');
  if (emptyCourts.length > 0) {
    return emptyCourts.reduce((min, c) => (c.id < min.id ? c : min)).id;
  }

  const playingCourts = courts.filter((c) => c.isPlaying && c.startedAt > 0);
  if (playingCourts.length === 0) return null;

  let best: Court = playingCourts[0];
  let bestElapsed = now - best.startedAt;
  for (const c of playingCourts.slice(1)) {
    const elapsed = now - c.startedAt;
    if (elapsed > bestElapsed || (elapsed === bestElapsed && c.id < best.id)) {
      best = c;
      bestElapsed = elapsed;
    }
  }
  return best.id;
}

/**
 * 読み上げ（TTS）用に名前から記号・絵文字・空白を除去する。
 * 残すのはひらがな・カタカナ・漢字・英数字・長音符（ー）・々のみ。
 * 表示用の body / toast には影響させない（読み上げ専用の加工）。
 * 絵文字はサロゲートペアだが、否定文字クラスなのでペアの各コードユニットが
 * 個別に除去対象となり結果として消える（u フラグは不要）。
 */
export function sanitizeNameForSpeech(name: string): string {
  return name.replace(/[^ぁ-ゟ゠-ヿ一-鿿々ーa-zA-Z0-9]/g, '');
}

/**
 * 呼び出し通知の本文。notification は改行あり、toast は1行。
 *
 * `courtNumber` は「コート番号を見出しに含めるか」の指示を呼び出し側から
 * 受け取るだけで、この関数自身は運用コート数などを判断しない。`null` を
 * 渡すと見出しからコート番号が消え `コート付近で試合終了をお待ちください` になる
 * （運用コートが1面のみで番号が冗長なケースを想定）。数値を渡した場合は
 * 従来どおり `${courtNumber}コート付近で試合終了をお待ちください`。
 * この差し替えは body / toast / speech の3つすべての見出しに反映される。
 *
 * `selfName` は読み上げ（speech）専用の引数。カクテルパーティ効果（雑音下でも
 * 自分の名前だけは注意を引く）を活かすため、speech だけは「名前 → 用件」の
 * 順に反転し、かつ自分の名前を先頭に寄せる。体育館の喧騒で聞き始めが遅れたり
 * 頭の用件部分を聞き流したりしても、最初の一言で自分宛だと気づけるようにする。
 * body / toast は表示なので聞き逃しの心配が無く、順序は変更しない。
 */
export function buildNextMatchCallMessage(
  courtNumber: number | null,
  names: string[],
  selfName?: string,
): { body: string; toast: string; speech: string } {
  const namesText = names.map((n) => `${n}さん`).join('・');
  const headline =
    courtNumber === null
      ? 'コート付近で試合終了をお待ちください'
      : `${courtNumber}コート付近で試合終了をお待ちください`;

  // speech だけ区切りが「、」なのは TTS 前提のため。「・」は無音のまま
  // 素通りされることがあり、読点の方が自然な間が入る。括弧も使わない
  // （TTS が不自然に読む/長く止まるため）。
  let speechNames = names.map((n) => sanitizeNameForSpeech(n)).filter((n) => n !== '');
  if (selfName !== undefined) {
    const sanitizedSelf = sanitizeNameForSpeech(selfName);
    const selfIndex = speechNames.indexOf(sanitizedSelf);
    if (sanitizedSelf !== '' && selfIndex > 0) {
      speechNames = [
        sanitizedSelf,
        ...speechNames.slice(0, selfIndex),
        ...speechNames.slice(selfIndex + 1),
      ];
    }
  }
  // 「名前 → 用件」に反転。名前が1件も残らなければ見出しのみ（現状どおり）。
  const speech =
    speechNames.length === 0
      ? headline
      : `${speechNames.map((n) => `${n}さん`).join('、')}。${headline}`;

  if (names.length === 0) {
    return { body: headline, toast: headline, speech };
  }

  return {
    body: `${headline}\n${namesText}`,
    toast: `${headline}（${namesText}）`,
    speech,
  };
}
