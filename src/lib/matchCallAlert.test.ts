import { describe, it, expect, vi, afterEach } from 'vitest';
import { useSettingsStore } from '../stores/settingsStore';
import {
  playMatchCallChime,
  vibrateMatchCall,
  fireMatchCallAlert,
  unlockMatchCallAudio,
  speakMatchCall,
  primeSpeechSynthesis,
  cancelMatchCallSpeech,
  installMatchCallSpeechHideGuard,
  getLastMatchCallSpeech,
  clearLastMatchCallSpeech,
  SPEECH_DELAY_MS,
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
    vi.advanceTimersByTime(200);
    vi.useRealTimers();

    expect(speakMock).not.toHaveBeenCalled();
  });

  it('設定 ON かつ speechText ありで 200ms 後に speak が呼ばれる', () => {
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
    vi.advanceTimersByTime(199);
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

describe('getLastMatchCallSpeech（直前のコールの記録）', () => {
  const originalMatchCallAlert = useSettingsStore.getState().matchCallAlert;

  function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', {
      value: state,
      writable: true,
      configurable: true,
    });
  }

  afterEach(() => {
    clearLastMatchCallSpeech();
    setVisibility('visible');
    useSettingsStore.setState({ matchCallAlert: originalMatchCallAlert });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('一度もコールが起きていなければ null', () => {
    clearLastMatchCallSpeech();
    expect(getLastMatchCallSpeech()).toBeNull();
  });

  it('fireMatchCallAlert の speechText を記録し、後のコールで上書きする', () => {
    useSettingsStore.setState({ matchCallAlert: true });
    clearLastMatchCallSpeech();

    fireMatchCallAlert('太郎さん。1コート付近で試合終了をお待ちください');
    expect(getLastMatchCallSpeech()).toBe('太郎さん。1コート付近で試合終了をお待ちください');

    fireMatchCallAlert('花子さん、もうすぐ2コートで試合です');
    expect(getLastMatchCallSpeech()).toBe('花子さん、もうすぐ2コートで試合です');
  });

  it('設定 OFF で鳴らせなかったコールも記録する（あとで鳴らし直せるように）', () => {
    useSettingsStore.setState({ matchCallAlert: false });
    clearLastMatchCallSpeech();

    fireMatchCallAlert('太郎さん');

    expect(getLastMatchCallSpeech()).toBe('太郎さん');
  });

  it('hidden 中で鳴らせなかったコールも記録する', () => {
    useSettingsStore.setState({ matchCallAlert: true });
    clearLastMatchCallSpeech();
    setVisibility('hidden');

    fireMatchCallAlert('太郎さん');

    expect(getLastMatchCallSpeech()).toBe('太郎さん');
  });

  it('speechText なしのコールでは記録を消さない', () => {
    useSettingsStore.setState({ matchCallAlert: true });
    clearLastMatchCallSpeech();

    fireMatchCallAlert('太郎さん');
    fireMatchCallAlert();

    expect(getLastMatchCallSpeech()).toBe('太郎さん');
  });
});

describe('speakMatchCall / primeSpeechSynthesis', () => {
  afterEach(() => {
    // タップキャンセル用の pointerdown リスナーが次のテストへ残らないよう
    // 念のため解除しておく（speechSynthesis 未対応でも throw しない）。
    cancelMatchCallSpeech();
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

  it('読み上げ中に document へ pointerdown を dispatch すると speechSynthesis.cancel が呼ばれる', () => {
    const { speakMock, cancelMock } = stubSpeechSynthesis();
    speakMatchCall('太郎さん');
    // speakMatchCall 冒頭の cancel() 呼び出し分をリセットしてから検証する。
    cancelMock.mockClear();

    document.dispatchEvent(new Event('pointerdown'));

    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(speakMock).toHaveBeenCalledTimes(1);
  });

  it('utterance.onend が発火した後は pointerdown を dispatch しても cancel が追加で呼ばれない', () => {
    const { speakMock, cancelMock } = stubSpeechSynthesis();
    speakMatchCall('太郎さん');
    const utterance = speakMock.mock.calls[0][0] as { onend?: () => void };
    cancelMock.mockClear();

    // 読み上げが自然に終わったことを模す。
    utterance.onend?.();
    document.dispatchEvent(new Event('pointerdown'));

    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('cancelMatchCallSpeech は speechSynthesis.cancel を呼ぶ', () => {
    const { cancelMock } = stubSpeechSynthesis();
    cancelMatchCallSpeech();
    expect(cancelMock).toHaveBeenCalledTimes(1);
  });

  it('cancelMatchCallSpeech は speechSynthesis 未対応環境（window に無い）でも throw しない', () => {
    expect(() => cancelMatchCallSpeech()).not.toThrow();
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

describe('バックグラウンド（hidden）中の抑制', () => {
  const originalMatchCallAlert = useSettingsStore.getState().matchCallAlert;

  /** jsdom の `document.visibilityState` は読み取り専用なので defineProperty で差し替える。 */
  function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', {
      value: state,
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }

  function stubSpeechSynthesis() {
    const speakMock = vi.fn();
    const cancelMock = vi.fn();
    vi.stubGlobal('speechSynthesis', { cancel: cancelMock, speak: speakMock });
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        text: string;
        lang = '';
        volume = 1;
        constructor(text: string) {
          this.text = text;
        }
      },
    );
    return { speakMock, cancelMock };
  }

  afterEach(() => {
    cancelMatchCallSpeech();
    setVisibility('visible');
    useSettingsStore.setState({ matchCallAlert: originalMatchCallAlert });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('hidden 中の fireMatchCallAlert は振動も読み上げもしない', () => {
    useSettingsStore.setState({ matchCallAlert: true });
    const { speakMock } = stubSpeechSynthesis();
    const vibrateMock = vi.fn();
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrateMock,
      writable: true,
      configurable: true,
    });
    setVisibility('hidden');

    vi.useFakeTimers();
    fireMatchCallAlert('太郎さん');
    vi.advanceTimersByTime(SPEECH_DELAY_MS);

    expect(vibrateMock).not.toHaveBeenCalled();
    expect(speakMock).not.toHaveBeenCalled();
  });

  it('hidden 中の speakMatchCall は speak を呼ばない（復帰時にまとめて再生されるのを防ぐ）', () => {
    const { speakMock } = stubSpeechSynthesis();
    setVisibility('hidden');

    speakMatchCall('太郎さん');

    expect(speakMock).not.toHaveBeenCalled();
  });

  it('チャイム後の読み上げ待ちの間に hidden になったら読み上げない', () => {
    useSettingsStore.setState({ matchCallAlert: true });
    const { speakMock } = stubSpeechSynthesis();
    const cleanup = installMatchCallSpeechHideGuard();

    vi.useFakeTimers();
    fireMatchCallAlert('太郎さん');
    vi.advanceTimersByTime(SPEECH_DELAY_MS - 1);
    setVisibility('hidden');
    vi.advanceTimersByTime(1000);

    expect(speakMock).not.toHaveBeenCalled();
    cleanup();
  });

  it('installMatchCallSpeechHideGuard は hidden への遷移で cancel し、クリーンアップ後は反応しない', () => {
    const { cancelMock } = stubSpeechSynthesis();
    const cleanup = installMatchCallSpeechHideGuard();

    setVisibility('hidden');
    expect(cancelMock).toHaveBeenCalledTimes(1);

    // visible への復帰では cancel しない（復帰直後の正当な読み上げを潰さないため）
    setVisibility('visible');
    expect(cancelMock).toHaveBeenCalledTimes(1);

    cleanup();
    setVisibility('hidden');
    expect(cancelMock).toHaveBeenCalledTimes(1);
  });
});
