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
