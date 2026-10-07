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

/** 進行表の通番 ↔ 参加予定メンバーの番号でフルネームに対応付ける。対応しない行は除外。 */
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
    const fullName = serial ? fullNameByNo.get(serial) : undefined;
    if (!fullName) continue;
    result.push({ serial, fullName, displayName: row.nameText.trim() });
  }
  return result;
}

/**
 * 対象者と進行表の行を照合する。名前は空白類を除いた完全一致。
 * セッションの名前は E-ToMo のニックネーム（進行表の名前列の表示）なので、まず
 * displayName で、見つからなければフルネームで照合する。同じ行は1回だけ返す。
 */
export function matchTargetsToRows(
  rows: ProgressRow[],
  targetNames: string[],
): { toRegister: ProgressRow[]; notFound: string[] } {
  const byDisplayName = new Map<string, ProgressRow>();
  const byFullName = new Map<string, ProgressRow>();
  for (const row of rows) {
    const display = normalizeName(row.displayName);
    if (display && !byDisplayName.has(display)) byDisplayName.set(display, row);
    const full = normalizeName(row.fullName);
    if (full && !byFullName.has(full)) byFullName.set(full, row);
  }

  const toRegister: ProgressRow[] = [];
  const notFound: string[] = [];
  const usedSerials = new Set<string>();
  for (const name of targetNames) {
    const key = normalizeName(name);
    const row = byDisplayName.get(key) ?? byFullName.get(key);
    if (!row) {
      notFound.push(name);
    } else if (!usedSerials.has(row.serial)) {
      usedSerials.add(row.serial);
      toRegister.push(row);
    }
  }
  return { toRegister, notFound };
}
