/**
 * E-ToMo 進行表への自動チェックイン用の純粋関数。
 * 詳細: docs/plans/2026-10-07-etomo-checkin.md
 */
import type { GameState } from '../services/sessionService';

/** 進行表の1行（DOM から抽出したプレーンデータ） */
export interface ProgressRowRaw {
  /** 通番セルの文字列 */
  serial: string;
  /** 名前セル（リンク）の文言 */
  nameText: string;
}

/** 「参加予定メンバー」一覧の1件 */
export interface ProgressMemberRaw {
  /** 一覧の番号（通番と対応） */
  no: string;
  fullName: string;
}

export interface ProgressRow {
  serial: string;
  fullName: string;
  /** 進行表の名前セルに表示されている文言（ニックネームのことがある） */
  displayName: string;
}

/** 名前比較用の正規化（前後空白と全角/半角スペースを除去） */
export function normalizeName(name: string): string {
  return name.replace(/[\s\u3000]+/g, '');
}

/** 終了済み試合に1回以上出たプレイヤー名（初出順・重複なし・trim・空除外） */
export function collectPlayedPlayerNames(gameState: GameState): string[] {
  const nameById = new Map<string, string>();
  for (const p of gameState.players ?? []) nameById.set(p.id, p.name);

  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of gameState.matchHistory ?? []) {
    if (!(match.finishedAt > 0)) continue;
    for (const id of [...match.teamA, ...match.teamB]) {
      if (!id) continue;
      const name = nameById.get(id)?.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

function normalizeNumber(s: string): string {
  // 全角数字→半角、数字以外を除去し先頭ゼロを落とす
  const half = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const digits = half.replace(/\D/g, '');
  return digits === '' ? '' : String(parseInt(digits, 10));
}

/**
 * 進行表の通番 ↔ 参加予定メンバーの番号でフルネームに対応付ける。
 * 対応が取れない行も捨てず、名前セルの文言をフルネームとみなす（進行表の名前は本名）。
 */
export function parseProgressTable(
  rows: ProgressRowRaw[],
  members: ProgressMemberRaw[],
): ProgressRow[] {
  const fullNameByNo = new Map<string, string>();
  for (const m of members) {
    const no = normalizeNumber(m.no);
    const fullName = m.fullName.trim();
    if (no && fullName && !fullNameByNo.has(no)) fullNameByNo.set(no, fullName);
  }

  const result: ProgressRow[] = [];
  for (const row of rows) {
    const serial = normalizeNumber(row.serial);
    if (!serial) continue;
    const displayName = row.nameText.trim();
    const fullName = fullNameByNo.get(serial) ?? displayName;
    if (!fullName) continue;
    result.push({ serial, fullName, displayName });
  }
  return result;
}

/** E-ToMo メンバー一覧の1件 */
export interface EtomoUser {
  realName: string;
  nickname: string;
}

function decodeEntities(str: string): string {
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * E-ToMo メンバー一覧（master/user_list.php）の HTML から本名とニックネームを抜き出す。
 * ヘッダ行（「ニックネーム」列と、ニックネーム/ふりがな系でない「名前」列）で列位置を特定する。
 */
export function parseUserListHtml(html: string): EtomoUser[] {
  const trs = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi);
  if (!trs) return [];

  let nameIdx = -1;
  let nickIdx = -1;
  const results: EtomoUser[] = [];
  for (const tr of trs) {
    const cellMatches = tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi);
    if (!cellMatches) continue;
    const cells = cellMatches.map((c) =>
      decodeEntities(c.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()),
    );

    if (nameIdx < 0 || nickIdx < 0) {
      const k = cells.findIndex((c) => c.includes('ニックネーム'));
      if (k >= 0) {
        const n = cells.findIndex(
          (c) =>
            c.includes('名前') &&
            !c.includes('ニックネーム') &&
            !c.includes('ふりがな') &&
            !c.includes('フリガナ') &&
            !c.includes('フリ'),
        );
        if (n >= 0) {
          nameIdx = n;
          nickIdx = k;
        }
      }
      continue;
    }

    if (cells.length <= Math.max(nameIdx, nickIdx)) continue;
    const realName = cells[nameIdx];
    const nickname = cells[nickIdx];
    if (realName && nickname) results.push({ realName, nickname });
  }
  return results;
}

export interface ResolvedName {
  /** セッション上の名前（ニックネーム） */
  name: string;
  /** E-ToMo の本名（正表記） */
  realName: string;
}

/**
 * セッション上の名前を E-ToMo の本名に解決する。
 * ニックネーム一致 → 本名一致（正表記の本名を採用）の順。どちらも無ければ未解決。
 */
export function resolveRealNames(
  targetNames: string[],
  users: EtomoUser[],
  participantNames?: string[],
): { resolved: ResolvedName[]; unresolved: string[] } {
  // 進行表の参加者（本名）が渡されたら、メンバー一覧をその人たちに絞ってから引く。
  // 退会者などと同じニックネームがあっても当日の参加者を取り違えない。
  const participants = participantNames && new Set(participantNames.map(normalizeName).filter(Boolean));
  const candidates = participants ? users.filter((u) => participants.has(normalizeName(u.realName))) : users;
  const realByNick = new Map<string, string>();
  const realByReal = new Map<string, string>();
  for (const u of candidates) {
    const nick = normalizeName(u.nickname);
    const real = normalizeName(u.realName);
    if (nick && !realByNick.has(nick)) realByNick.set(nick, u.realName);
    if (real && !realByReal.has(real)) realByReal.set(real, u.realName);
  }

  const resolved: ResolvedName[] = [];
  const unresolved: string[] = [];
  for (const name of targetNames) {
    const key = normalizeName(name);
    const realName = realByNick.get(key) ?? realByReal.get(key);
    if (realName) resolved.push({ name, realName });
    else unresolved.push(name);
  }
  return { resolved, unresolved };
}

export interface CheckinTarget {
  row: ProgressRow;
  nickname: string;
  realName: string;
}

/**
 * 本名を解決済みの対象者と進行表の行を照合する。名前は空白類を除いた完全一致。
 * 行の照合キーは fullName と displayName の両方（どちらかが本名と一致すれば可）。
 * 同じ行は1回だけ返す。進行表に居ない対象は notFound。
 */
export function matchTargetsToRows(
  rows: ProgressRow[],
  targets: ResolvedName[],
): { toRegister: CheckinTarget[]; notFound: ResolvedName[] } {
  const byFullName = new Map<string, ProgressRow>();
  const byDisplayName = new Map<string, ProgressRow>();
  for (const row of rows) {
    const full = normalizeName(row.fullName);
    if (full && !byFullName.has(full)) byFullName.set(full, row);
    const display = normalizeName(row.displayName);
    if (display && !byDisplayName.has(display)) byDisplayName.set(display, row);
  }

  const toRegister: CheckinTarget[] = [];
  const notFound: ResolvedName[] = [];
  const usedSerials = new Set<string>();
  for (const t of targets) {
    const key = normalizeName(t.realName);
    const row = byFullName.get(key) ?? byDisplayName.get(key);
    if (!row) {
      notFound.push(t);
    } else if (!usedSerials.has(row.serial)) {
      usedSerials.add(row.serial);
      toRegister.push({ row, nickname: t.name, realName: t.realName });
    }
  }
  return { toRegister, notFound };
}
