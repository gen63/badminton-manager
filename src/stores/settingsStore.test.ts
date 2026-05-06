import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from './settingsStore';

describe('settingsStore - setPracticeType と prioritizeDiversity の整合', () => {
  beforeEach(() => {
    // テスト間で状態をリセット
    useSettingsStore.setState({
      practiceType: '複',
      prioritizeDiversity: false,
    });
  });

  it('単 を設定すると prioritizeDiversity が false に強制される', () => {
    useSettingsStore.setState({ prioritizeDiversity: true });
    useSettingsStore.getState().setPracticeType('単');
    const state = useSettingsStore.getState();
    expect(state.practiceType).toBe('単');
    expect(state.prioritizeDiversity).toBe(false);
  });

  it('楽 を設定すると prioritizeDiversity が true に強制される', () => {
    useSettingsStore.setState({ prioritizeDiversity: false });
    useSettingsStore.getState().setPracticeType('楽');
    const state = useSettingsStore.getState();
    expect(state.practiceType).toBe('楽');
    expect(state.prioritizeDiversity).toBe(true);
  });

  it('単 → 楽 切替で prioritizeDiversity が false → true に補正される', () => {
    useSettingsStore.getState().setPracticeType('単');
    expect(useSettingsStore.getState().prioritizeDiversity).toBe(false);
    useSettingsStore.getState().setPracticeType('楽');
    expect(useSettingsStore.getState().prioritizeDiversity).toBe(true);
  });

  it('複 を設定しても prioritizeDiversity は変更されない（ユーザー任意）', () => {
    useSettingsStore.setState({ prioritizeDiversity: true });
    useSettingsStore.getState().setPracticeType('複');
    expect(useSettingsStore.getState().prioritizeDiversity).toBe(true);

    useSettingsStore.setState({ prioritizeDiversity: false });
    useSettingsStore.getState().setPracticeType('複');
    expect(useSettingsStore.getState().prioritizeDiversity).toBe(false);
  });

  it('楽 → 複 切替で prioritizeDiversity は true のまま（明示変更まで保持）', () => {
    useSettingsStore.getState().setPracticeType('楽');
    expect(useSettingsStore.getState().prioritizeDiversity).toBe(true);
    useSettingsStore.getState().setPracticeType('複');
    expect(useSettingsStore.getState().prioritizeDiversity).toBe(true);
  });
});

describe('settingsStore - persist (Phase A: 同期対象を localStorage から外す)', () => {
  it('Firestore 同期対象 (practiceType / continuousMatchMode / recordScores) は localStorage に書かれない', () => {
    useSettingsStore.setState({
      practiceType: '楽',
      continuousMatchMode: false,
      recordScores: false,
      prioritizeDiversity: true,
      useStayDurationPriority: false,
    });

    const raw = localStorage.getItem('badminton-settings');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    const stored = parsed.state ?? parsed;
    expect(stored).not.toHaveProperty('practiceType');
    expect(stored).not.toHaveProperty('continuousMatchMode');
    expect(stored).not.toHaveProperty('recordScores');
    // 端末ローカル設定は書かれている
    expect(stored).toHaveProperty('prioritizeDiversity', true);
    expect(stored).toHaveProperty('useStayDurationPriority', false);
    expect(stored).toHaveProperty('gasWebAppUrl');
    expect(stored).toHaveProperty('accountingWebAppUrl');
  });

  it('migrate (version 0 → 1) で旧 persisted state から同期対象を剥がす', () => {
    // settingsStore.ts の migrate と同じロジックを再現してテストする
    // (zustand persist 内部の migrate を再エクスポートしていないため)
    const migrate = (persisted: unknown, version: number): unknown => {
      if (version < 1 && persisted && typeof persisted === 'object') {
        const { practiceType: _pt, continuousMatchMode: _cm, recordScores: _rs, ...rest } =
          persisted as Record<string, unknown>;
        void _pt;
        void _cm;
        void _rs;
        return rest;
      }
      return persisted;
    };

    const oldState = {
      gasWebAppUrl: 'https://example.com/gas',
      accountingWebAppUrl: 'https://example.com/acc',
      useStayDurationPriority: true,
      prioritizeDiversity: false,
      practiceType: '単',
      continuousMatchMode: false,
      recordScores: false,
    };
    const migrated = migrate(oldState, 0) as Record<string, unknown>;
    expect(migrated).not.toHaveProperty('practiceType');
    expect(migrated).not.toHaveProperty('continuousMatchMode');
    expect(migrated).not.toHaveProperty('recordScores');
    expect(migrated.gasWebAppUrl).toBe('https://example.com/gas');
    expect(migrated.useStayDurationPriority).toBe(true);
  });
});
