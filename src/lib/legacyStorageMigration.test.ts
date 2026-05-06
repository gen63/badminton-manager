import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupLegacyLocalStorage } from './legacyStorageMigration';

describe('cleanupLegacyLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('Phase 3 で persist 撤去した zustand キーを削除する', () => {
    localStorage.setItem('badminton-players', '{"foo":1}');
    localStorage.setItem('badminton-game', '{"bar":2}');
    localStorage.setItem('badminton-reservations', '{"baz":3}');

    cleanupLegacyLocalStorage();

    expect(localStorage.getItem('badminton-players')).toBeNull();
    expect(localStorage.getItem('badminton-game')).toBeNull();
    expect(localStorage.getItem('badminton-reservations')).toBeNull();
  });

  it('Phase 4 で廃止した firebase_session_* を削除する', () => {
    localStorage.setItem('firebase_session_abc123', '{"foo":1}');
    localStorage.setItem('firebase_session_def456', '{"bar":2}');
    // 関連の無いキーは残す
    localStorage.setItem('keep-me', 'kept');

    cleanupLegacyLocalStorage();

    expect(localStorage.getItem('firebase_session_abc123')).toBeNull();
    expect(localStorage.getItem('firebase_session_def456')).toBeNull();
    expect(localStorage.getItem('keep-me')).toBe('kept');
  });

  it('Phase C (v2) で persist 撤廃した accounting-storage を削除する', () => {
    localStorage.setItem('accounting-storage', '{"records":[]}');

    cleanupLegacyLocalStorage();

    expect(localStorage.getItem('accounting-storage')).toBeNull();
  });

  it('badminton-settings (現役 persist キー) は触らない', () => {
    localStorage.setItem('badminton-settings', '{"state":{"foo":1}}');

    cleanupLegacyLocalStorage();

    expect(localStorage.getItem('badminton-settings')).toBe('{"state":{"foo":1}}');
  });

  it('badminton-session (現役 persist キー、currentUser のみ) は触らない', () => {
    localStorage.setItem('badminton-session', '{"state":{"currentUser":"Alice"}}');

    cleanupLegacyLocalStorage();

    expect(localStorage.getItem('badminton-session')).toBe(
      '{"state":{"currentUser":"Alice"}}',
    );
  });

  it('既に v2 cleanup 済みなら何もしない（冪等）', () => {
    localStorage.setItem('badminton-legacy-cleanup-v2', '1');
    localStorage.setItem('badminton-players', '{"foo":1}');
    localStorage.setItem('accounting-storage', '{"records":[]}');

    cleanupLegacyLocalStorage();

    // フラグが立っているので削除されない
    expect(localStorage.getItem('badminton-players')).toBe('{"foo":1}');
    expect(localStorage.getItem('accounting-storage')).toBe('{"records":[]}');
  });

  it('v1 から v2 に上がるユーザーは旧 v1 フラグを掃除して v2 cleanup を実行', () => {
    localStorage.setItem('badminton-legacy-cleanup-v1', '1');
    localStorage.setItem('accounting-storage', '{"records":[]}');

    cleanupLegacyLocalStorage();

    expect(localStorage.getItem('accounting-storage')).toBeNull();
    expect(localStorage.getItem('badminton-legacy-cleanup-v1')).toBeNull();
    expect(localStorage.getItem('badminton-legacy-cleanup-v2')).toBe('1');
  });
});
