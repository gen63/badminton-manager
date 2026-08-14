import { describe, it, expect, vi, afterEach } from 'vitest';
import { useSettingsStore } from '../stores/settingsStore';
import {
  playMatchCallChime,
  vibrateMatchCall,
  fireMatchCallAlert,
  unlockMatchCallAudio,
  speakMatchCall,
  primeSpeechSynthesis,
} from './matchCallAlert';

describe('vibrateMatchCall', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('navigator.vibrate があれば呼ばれる', () => {
    const vibrateMock = vi.fn();
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrateMock,
      writable: true,
      configurable: true,
    });

    vibrateMatchCall();
    expect(vibrateMock).toHaveBeenCalledWith([200, 100, 200]);
  });

  it('navigator.vibrate が未定義（iOS 等）でも throw しない', () => {
    Object.defineProperty(navigator, 'vibrate', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    expect(() => vibrateMatchCall()).not.toThrow();
  });
});

describe('playMatchCallChime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AudioContext が未生成（unlock 未実施）でも throw しない', () => {
    expect(() => playMatchCallChime()).not.toThrow();
  });

  it('unlock 済みなら oscillator を2つ生成してビープを鳴らす', () => {
    const oscillatorFactory = () => ({
      frequency: { value: 0 },
      type: 'sine',
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    });
    const gainFactory = () => ({
      gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    });
    const audioContextMock = {
      state: 'running',
      currentTime: 0,
      resume: vi.fn().mockResolvedValue(undefined),
      createOscillator: vi.fn(oscillatorFactory),
      createGain: vi.fn(gainFactory),
      destination: {},
    };
    class AudioContextMock {
      constructor() {
        return audioContextMock as unknown as AudioContextMock;
      }
    }
    vi.stubGlobal('AudioContext', AudioContextMock);

    unlockMatchCallAudio();
    expect(() => playMatchCallChime()).not.toThrow();
    expect(audioContextMock.createOscillator).toHaveBeenCalledTimes(2);
  });
});

describe('fireMatchCallAlert', () => {
  const originalMatchCallAlert = useSettingsStore.getState().matchCallAlert;

  afterEach(() => {
    useSettingsStore.setState({ matchCallAlert: originalMatchCallAlert });
    vi.unstubAllGlobals();
  });

  it('設定 OFF なら navigator.vibrate が呼ばれない', () => {
    useSettingsStore.setState({ matchCallAlert: false });
    const vibrateMock = vi.fn();
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrateMock,
      writable: true,
      configurable: true,
    });

    fireMatchCallAlert();
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it('設定 ON なら navigator.vibrate が呼ばれる', () => {
    useSettingsStore.setState({ matchCallAlert: true });
    const vibrateMock = vi.fn();
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrateMock,
      writable: true,
      configurable: true,
    });

    fireMatchCallAlert();
    expect(vibrateMock).toHaveBeenCalledWith([200, 100, 200]);
  });

  it('設定 OFF なら speechText ありでも speak が呼ばれない', () => {
    useSettingsStore.setState({ matchCallAlert: false });
    const speakMock = vi.fn();
    vi.stubGlobal('speechSynthesis', { cancel: vi.fn(), speak: speakMock });
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        text: string;
        lang = '';
        constructor(text: string) {
          this.text = text;
        }
      },
    );

    vi.useFakeTimers();
    fireMatchCallAlert('太郎さん');
    vi.advanceTimersByTime(400);
    vi.useRealTimers();

    expect(speakMock).not.toHaveBeenCalled();
  });

  it('設定 ON かつ speechText ありで 400ms 後に speak が呼ばれる', () => {
    useSettingsStore.setState({ matchCallAlert: true });
    const speakMock = vi.fn();
    vi.stubGlobal('speechSynthesis', { cancel: vi.fn(), speak: speakMock });
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        text: string;
        lang = '';
        constructor(text: string) {
          this.text = text;
        }
      },
    );

    vi.useFakeTimers();
    fireMatchCallAlert('太郎さん');
    expect(speakMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(399);
    expect(speakMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    vi.useRealTimers();

    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(speakMock.mock.calls[0][0].text).toBe('太郎さん');
  });

  it('speechText 未指定なら speak が呼ばれない', () => {
    useSettingsStore.setState({ matchCallAlert: true });
    const speakMock = vi.fn();
    vi.stubGlobal('speechSynthesis', { cancel: vi.fn(), speak: speakMock });
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        text: string;
        lang = '';
        constructor(text: string) {
          this.text = text;
        }
      },
    );

    vi.useFakeTimers();
    fireMatchCallAlert();
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();

    expect(speakMock).not.toHaveBeenCalled();
  });
});

describe('speakMatchCall / primeSpeechSynthesis', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubSpeechSynthesis() {
    const speakMock = vi.fn();
    const cancelMock = vi.fn();
    vi.stubGlobal('speechSynthesis', { cancel: cancelMock, speak: speakMock });
    class UtteranceMock {
      text: string;
      lang = '';
      volume = 1;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal('SpeechSynthesisUtterance', UtteranceMock);
    return { speakMock, cancelMock, UtteranceMock };
  }

  it('speechSynthesis 未対応環境（window に無い）で throw しない', () => {
    expect(() => speakMatchCall('テスト')).not.toThrow();
    expect(() => primeSpeechSynthesis()).not.toThrow();
  });

  it('text が空文字なら speak を呼ばない', () => {
    const { speakMock } = stubSpeechSynthesis();
    speakMatchCall('');
    expect(speakMock).not.toHaveBeenCalled();
  });

  it('speak 前に cancel を呼び、lang=ja-JP で speak する', () => {
    const { speakMock, cancelMock } = stubSpeechSynthesis();
    speakMatchCall('太郎さん');
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(speakMock).toHaveBeenCalledTimes(1);
    const utterance = speakMock.mock.calls[0][0];
    expect(utterance.lang).toBe('ja-JP');
    expect(utterance.text).toBe('太郎さん');
  });

  it('primeSpeechSynthesis は volume=0 の発話を speak する（冪等）', () => {
    const { speakMock } = stubSpeechSynthesis();
    primeSpeechSynthesis();
    primeSpeechSynthesis();
    expect(speakMock).toHaveBeenCalledTimes(2);
    for (const call of speakMock.mock.calls) {
      expect(call[0].volume).toBe(0);
    }
  });
});

describe('installMatchCallAudioUnlock', () => {
  // audioContext はモジュールシングルトンなので、テストごとに vi.resetModules() +
  // 動的 import で独立したモジュールインスタンスを使い、干渉を防ぐ。
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('pointerdown を dispatch すると AudioContext が生成される', async () => {
    vi.resetModules();
    const ctorSpy = vi.fn();
    class SpyAudioContext {
      constructor() {
        ctorSpy();
      }
    }
    vi.stubGlobal('AudioContext', SpyAudioContext);

    const mod = await import('./matchCallAlert');
    const cleanup = mod.installMatchCallAudioUnlock();
    document.dispatchEvent(new Event('pointerdown'));

    expect(ctorSpy).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('クリーンアップ後は pointerdown を dispatch しても生成されない', async () => {
    vi.resetModules();
    const ctorSpy = vi.fn();
    class SpyAudioContext {
      constructor() {
        ctorSpy();
      }
    }
    vi.stubGlobal('AudioContext', SpyAudioContext);

    const mod = await import('./matchCallAlert');
    const cleanup = mod.installMatchCallAudioUnlock();
    cleanup();
    document.dispatchEvent(new Event('pointerdown'));

    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it('pointerdown 発火後は keydown のリスナーも外れている（2回実行されない）', async () => {
    vi.resetModules();
    const ctorSpy = vi.fn();
    class SpyAudioContext {
      constructor() {
        ctorSpy();
      }
    }
    vi.stubGlobal('AudioContext', SpyAudioContext);

    const mod = await import('./matchCallAlert');
    mod.installMatchCallAudioUnlock();
    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new KeyboardEvent('keydown'));

    expect(ctorSpy).toHaveBeenCalledTimes(1);
  });
});
