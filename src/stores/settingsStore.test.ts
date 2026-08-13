import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from './settingsStore';

describe('settingsStore - setPracticeType と forceBulkAssignment の整合', () => {
  beforeEach(() => {
    // テスト間で状態をリセット
    useSettingsStore.setState({
      practiceType: '複',
      forceBulkAssignment: false,
    });
  });

  it('単 を設定すると forceBulkAssignment が false に強制される', () => {
    useSettingsStore.setState({ forceBulkAssignment: true });
    useSettingsStore.getState().setPracticeType('単');
    const state = useSettingsStore.getState();
    expect(state.practiceType).toBe('単');
    expect(state.forceBulkAssignment).toBe(false);
  });

  it('楽 を設定すると forceBulkAssignment が true に強制される', () => {
    useSettingsStore.setState({ forceBulkAssignment: false });
    useSettingsStore.getState().setPracticeType('楽');
    const state = useSettingsStore.getState();
    expect(state.practiceType).toBe('楽');
    expect(state.forceBulkAssignment).toBe(true);
  });

  it('単 → 楽 切替で forceBulkAssignment が false → true に補正される', () => {
    useSettingsStore.getState().setPracticeType('単');
    expect(useSettingsStore.getState().forceBulkAssignment).toBe(false);
    useSettingsStore.getState().setPracticeType('楽');
    expect(useSettingsStore.getState().forceBulkAssignment).toBe(true);
  });

  it('複 を設定しても forceBulkAssignment は変更されない（ユーザー任意）', () => {
    useSettingsStore.setState({ forceBulkAssignment: true });
    useSettingsStore.getState().setPracticeType('複');
    expect(useSettingsStore.getState().forceBulkAssignment).toBe(true);

    useSettingsStore.setState({ forceBulkAssignment: false });
    useSettingsStore.getState().setPracticeType('複');
    expect(useSettingsStore.getState().forceBulkAssignment).toBe(false);
  });

  it('楽 → 複 切替で forceBulkAssignment は true のまま（明示変更まで保持）', () => {
    useSettingsStore.getState().setPracticeType('楽');
    expect(useSettingsStore.getState().forceBulkAssignment).toBe(true);
    useSettingsStore.getState().setPracticeType('複');
    expect(useSettingsStore.getState().forceBulkAssignment).toBe(true);
  });
});

describe('settingsStore - persist (Phase A: 同期対象を localStorage から外す)', () => {
  it('Firestore 同期対象 (practiceType / continuousMatchMode / recordScores / useStayDurationPriority / forceBulkAssignment) は localStorage に書かれない', () => {
    useSettingsStore.setState({
      practiceType: '楽',
      continuousMatchMode: false,
      recordScores: false,
      forceBulkAssignment: true,
      useStayDurationPriority: false,
    });

    const raw = localStorage.getItem('badminton-settings');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    const stored = parsed.state ?? parsed;
    expect(stored).not.toHaveProperty('practiceType');
    expect(stored).not.toHaveProperty('continuousMatchMode');
    expect(stored).not.toHaveProperty('recordScores');
    // 配置モードもセッション設定なので localStorage には書かない
    // （docs/plans/2026-08-11-stay-duration-mode-not-applied.md）
    expect(stored).not.toHaveProperty('useStayDurationPriority');
    // forceBulkAssignment も同様にセッション設定なので localStorage には書かない
    // （docs/plans/2026-08-13-force-bulk-assignment.md）
    expect(stored).not.toHaveProperty('forceBulkAssignment');
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
      forceBulkAssignment: false,
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

  it('migrate (version 2 → 3) で旧 persisted state から useStayDurationPriority を剥がす', () => {
    // settingsStore.ts の migrate (version < 3 の分岐) と同じロジック
    const migrate = (persisted: unknown, version: number): unknown => {
      if (version < 3 && persisted && typeof persisted === 'object') {
        const { useStayDurationPriority: _sd, ...rest } = persisted as Record<string, unknown>;
        void _sd;
        return rest;
      }
      return persisted;
    };

    const oldState = {
      gasWebAppUrl: 'https://example.com/gas',
      accountingWebAppUrl: 'https://example.com/acc',
      useStayDurationPriority: false,
      forceBulkAssignment: false,
    };
    const migrated = migrate(oldState, 2) as Record<string, unknown>;
    expect(migrated).not.toHaveProperty('useStayDurationPriority');
    expect(migrated.gasWebAppUrl).toBe('https://example.com/gas');
    expect(migrated.forceBulkAssignment).toBe(false);
  });

  it('migrate (version 3 → 4) で旧 persisted state から prioritizeDiversity (旧名) を剥がす', () => {
    // settingsStore.ts の migrate (version < 4 の分岐) と同じロジック
    const migrate = (persisted: unknown, version: number): unknown => {
      if (version < 4 && persisted && typeof persisted === 'object') {
        const { prioritizeDiversity: _pd, ...rest } = persisted as Record<string, unknown>;
        void _pd;
        return rest;
      }
      return persisted;
    };

    const oldState = {
      gasWebAppUrl: 'https://example.com/gas',
      accountingWebAppUrl: 'https://example.com/acc',
      prioritizeDiversity: true,
    };
    const migrated = migrate(oldState, 3) as Record<string, unknown>;
    expect(migrated).not.toHaveProperty('prioritizeDiversity');
    expect(migrated.gasWebAppUrl).toBe('https://example.com/gas');
  });
});
