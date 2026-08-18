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
import {
  MATCH_CALL_THRESHOLD_MS,
  MATCH_CALL_COOLDOWN_MS,
  MATCH_CALL_ADMIN_THRESHOLD_MS,
} from './gameOperations';

/**
 * プレイ中コート（`isPlaying && startedAt > 0`）のうち経過時間が最大のコート。
 * 同着なら `id` の小さい方。プレイ中コートが無ければ null。
 * `maxPlayingElapsedMs` / `callBasisCourtId` / `adminAnnounceKey` が共通してこの
 * 「経過最大のコートを選ぶ」ロジックに依存する。
 */
export function maxPlayingCourt(courts: Court[], now: number): Court | null {
  let best: Court | null = null;
  let bestElapsed = -1;
  for (const c of courts) {
    if (!c.isPlaying || c.startedAt <= 0) continue;
    const elapsed = now - c.startedAt;
    if (best === null || elapsed > bestElapsed || (elapsed === bestElapsed && c.id < best.id)) {
      best = c;
      bestElapsed = elapsed;
    }
  }
  return best;
}

/** プレイ中コートの経過時間の最大値（ms）。プレイ中のコートが無ければ 0 */
export function maxPlayingElapsedMs(courts: Court[], now: number): number {
  const court = maxPlayingCourt(courts, now);
  return court === null ? 0 : now - court.startedAt;
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

  const best = maxPlayingCourt(courts, now);
  return best === null ? null : best.id;
}

/**
 * 管理者向けアナウンスの重複防止キー。プレイ中コートのうち経過時間が最大の
 * コートの `id` と `startedAt` を組にした文字列。このコートが閾値判定の基準
 * そのものなので、その試合が終わって次が始まれば `startedAt` が変わり、
 * 自然に次のサイクルのアナウンスが解禁される。プレイ中コートが無ければ null。
 * `shouldAnnounceToAdmin` の内部と呼び出し側（MainPage）の両方がこの関数で
 * キーを組み立てる必要がある（別々に組み立てるとずれるため）。
 */
export function adminAnnounceKey(courts: Court[], now: number): string | null {
  const court = maxPlayingCourt(courts, now);
  return court === null ? null : `${court.id}:${court.startedAt}`;
}

export interface ShouldAnnounceToAdminArgs {
  courts: Court[];
  /** 配置予測の「ほぼ確定」メンバー（候補 likelyIds は対象外） */
  certainIds: Set<string>;
  /** 自分の Player ID。特定できないときは null */
  myPlayerId: string | null;
  now: number;
  /** isAdmin()（作成者＋管理者、すなわち「管理者以上」） */
  isAdmin: boolean;
  /** 端末設定 adminMatchCallAnnounce */
  announceEnabled: boolean;
  /** 前回アナウンス時のキー（`adminAnnounceKey` で組み立てたもの）。未アナウンスなら null */
  alreadyAnnouncedKey: string | null;
}

/**
 * 管理者向け「もうすぐ試合です」アナウンスを出すべきか判定する。
 * 詳細: docs/plans/2026-08-15-admin-match-call-announce.md「## 発火条件」
 */
export function shouldAnnounceToAdmin(args: ShouldAnnounceToAdminArgs): boolean {
  const { courts, certainIds, myPlayerId, now, isAdmin, announceEnabled, alreadyAnnouncedKey } =
    args;

  if (!isAdmin) return false;
  if (!announceEnabled) return false;

  const key = adminAnnounceKey(courts, now);
  if (key === null || key === alreadyAnnouncedKey) return false;

  if (certainIds.size === 0) return false;
  // 自分が対象に含まれる場合は抑制する。管理者自身が呼ばれているなら 4:30 の
  // 本人向け通知を既に受け取っており、30秒後に管理者向けも鳴ると同じ端末が
  // 1サイクルに2回鳴って煩わしい。
  if (myPlayerId !== null && certainIds.has(myPlayerId)) return false;

  // 対象メンバー全員が既にどのコートかに乗っていれば、促す相手がいないので
  // アナウンスする意味が無い。1人以上が未着席のときだけ発火する。
  const allOnCourt = Array.from(certainIds).every((id) =>
    courts.some((c) => c.teamA.includes(id) || c.teamB.includes(id)),
  );
  if (allOnCourt) return false;

  return maxPlayingElapsedMs(courts, now) >= MATCH_CALL_ADMIN_THRESHOLD_MS;
}

/** 読み上げ時に無視する名前の接頭辞（ゲスト参加者を表す運用上のラベル）。 */
const SPEECH_IGNORED_NAME_PREFIXES = ['外部'];

/**
 * 読み上げ（TTS）用に名前から記号・絵文字・空白を除去し、ゲスト参加者を表す
 * 接頭辞（`外部` 等）を取り除く。残すのはひらがな・カタカナ・漢字・英数字・
 * 長音符（ー）・々のみ。表示用の body には影響させない（読み上げ専用の加工）。
 * 絵文字はサロゲートペアだが、否定文字クラスなのでペアの各コードユニットが
 * 個別に除去対象となり結果として消える（u フラグは不要）。
 *
 * 処理順序は「記号除去 → 接頭辞除去」で固定する。先に記号を除去することで
 * `【外部】はなこ` のような括弧付き表記も `外部はなこ` に正規化されてから
 * 接頭辞が落ち、`はなこ` になる。逆順だと括弧が接頭辞の前に残ってしまい
 * 除去できない。
 */
export function sanitizeNameForSpeech(name: string): string {
  const symbolsRemoved = name.replace(/[^ぁ-ゟ゠-ヿ一-鿿々ーa-zA-Z0-9]/g, '');
  for (const prefix of SPEECH_IGNORED_NAME_PREFIXES) {
    if (symbolsRemoved.startsWith(prefix)) {
      return symbolsRemoved.slice(prefix.length);
    }
  }
  return symbolsRemoved;
}

/**
 * 呼び出し通知の本文（OS 通知の body と読み上げ）。
 *
 * 以前は画面表示用の `toast` も返していたが、継続表示のガイド
 * （`FinishOperationGuide`）が同じ情報を消えずに出すようになったため廃止した。
 *
 * `courtNumber` は「コート番号を見出しに含めるか」の指示を呼び出し側から
 * 受け取るだけで、この関数自身は運用コート数などを判断しない。`null` を
 * 渡すと見出しからコート番号が消え `コート付近で試合終了をお待ちください` になる
 * （運用コートが1面のみで番号が冗長なケースを想定）。数値を渡した場合は
 * 従来どおり `${courtNumber}コート付近で試合終了をお待ちください`。
 * この差し替えは body / speech の両方の見出しに反映される。
 *
 * `selfName` は読み上げ（speech）専用の引数。カクテルパーティ効果（雑音下でも
 * 自分の名前だけは注意を引く）を活かすため、speech だけは「名前 → 用件」の
 * 順に反転し、かつ自分の名前を先頭に寄せる。体育館の喧騒で聞き始めが遅れたり
 * 頭の用件部分を聞き流したりしても、最初の一言で自分宛だと気づけるようにする。
 * body は表示なので聞き逃しの心配が無く、順序は変更しない。
 */
export function buildNextMatchCallMessage(
  courtNumber: number | null,
  names: string[],
  selfName?: string,
): { body: string; speech: string } {
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
    return { body: headline, speech };
  }

  return { body: `${headline}\n${namesText}`, speech };
}

/**
 * 管理者向け「もうすぐ試合です」アナウンスの文言。
 *
 * 本人向け（`buildNextMatchCallMessage`）と違い OS 通知も出さないため、返すのは
 * `{ speech }` だけ（画面表示は継続表示のガイドが担う）。`shouldAnnounceToAdmin` の
 * 条件5により自分は対象メンバーに含まれないため、`selfName` の先頭寄せは行わない。
 *
 * 名前は `sanitizeNameForSpeech` を通し、除去後に空文字になった名前は読み上げ
 * 対象から外す。
 *
 * `names` が空になるのは呼び出し側が呼ばない前提（`shouldAnnounceToAdmin` が
 * 対象0人なら false を返す）。ここでも `buildNextMatchCallMessage` と同様、
 * 名前が無ければ見出しのみの自然な文にする。
 */
export function buildAdminMatchCallMessage(
  courtNumber: number | null,
  names: string[],
): { speech: string } {
  const headline =
    courtNumber === null ? 'もうすぐ試合です' : `もうすぐ${courtNumber}コートで試合です`;

  if (names.length === 0) {
    return { speech: headline };
  }

  const speechNames = names.map((n) => sanitizeNameForSpeech(n)).filter((n) => n !== '');
  const speech =
    speechNames.length === 0
      ? headline
      : `${speechNames.map((n) => `${n}さん`).join('、')}、${headline}`;

  return { speech };
}
