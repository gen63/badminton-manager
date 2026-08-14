/**
 * 呼び出し通知に付随する音・振動ユーティリティ。
 *
 * OS 通知（`notifications.ts`）とは独立に、アプリを開いている端末で確実に
 * 気づけるよう WebAudio のビープ音と `navigator.vibrate` を鳴らす。
 * オフラインでも動くよう音声ファイルは使わず WebAudio で生成する。
 */
import { useSettingsStore } from '../stores/settingsStore';

type AudioContextConstructor = typeof AudioContext;

/** モジュールシングルトンの AudioContext。unlock 時に遅延生成する。 */
let audioContext: AudioContext | null = null;

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof AudioContext !== 'undefined') return AudioContext;
  const legacy = (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
  return legacy ?? null;
}

/**
 * AudioContext をユーザー操作ハンドラから呼び出して unlock する。
 * 未生成なら生成し、`suspended` 状態なら `resume()` する。
 * ブラウザが AudioContext に対応していない・生成や resume に失敗しても
 * 呼び出し側には影響させない（throw しない）。
 */
export function unlockMatchCallAudio(): void {
  try {
    if (!audioContext) {
      const Ctor = getAudioContextConstructor();
      if (!Ctor) return;
      audioContext = new Ctor();
    }
    if (audioContext.state === 'suspended') {
      void audioContext.resume().catch(() => {
        // resume 失敗は無視。次回のユーザー操作で再度 unlock を試みる。
      });
    }
  } catch (error) {
    console.error('[matchCallAlert] unlockMatchCallAudio failed:', error);
  }
}

/** 単音のビープを鳴らす（内部ヘルパー）。 */
function playBeep(ctx: AudioContext, frequency: number, startTime: number, duration: number): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.frequency.value = frequency;
  oscillator.type = 'sine';

  // クリックノイズを避けるため gain をランプさせる。マスター音量は控えめ。
  const peak = 0.2;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peak, startTime + 0.02);
  gain.gain.setValueAtTime(peak, startTime + duration - 0.02);
  gain.gain.linearRampToValueAtTime(0, startTime + duration);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
}

/**
 * 呼び出し通知用のチャイムを鳴らす（880Hz → 1175Hz の2音ビープ）。
 * AudioContext が未生成（unlock 未実施）・使用不可の場合は黙って何もしない。
 */
export function playMatchCallChime(): void {
  if (!audioContext) return;

  try {
    const now = audioContext.currentTime;
    const beepDuration = 0.15;
    playBeep(audioContext, 880, now, beepDuration);
    playBeep(audioContext, 1175, now + beepDuration, beepDuration);
  } catch (error) {
    console.error('[matchCallAlert] playMatchCallChime failed:', error);
  }
}

/**
 * アプリ内の最初のユーザー操作（`pointerdown` / `keydown`）で AudioContext を
 * unlock する。`matchCallAlert` のデフォルトが `true` のため、ベルボタンに
 * 一度も触れないユーザーの端末では unlock 契機が無く `playMatchCallChime()` が
 * 常に早期 return してしまう。ベルの onClick だけに頼らず、アプリ起動後の
 * 最初のタップ・キー操作を汎用的な unlock 契機として使う。
 *
 * `{ once: true }` は自身のリスナーしか外さないため、片方が先に発火したら
 * 共通ハンドラ内でもう片方も明示的に `removeEventListener` する。
 *
 * 戻り値は両方のリスナーを解除するクリーンアップ関数（`useEffect` の
 * 戻り値にそのまま渡せる）。冪等（二重登録・unlock 済み状態での再呼び出し
 * いずれも安全）。
 */
export function installMatchCallAudioUnlock(): () => void {
  const handleFirstInteraction = () => {
    document.removeEventListener('pointerdown', handleFirstInteraction);
    document.removeEventListener('keydown', handleFirstInteraction);
    unlockMatchCallAudio();
  };

  document.addEventListener('pointerdown', handleFirstInteraction, { once: true });
  document.addEventListener('keydown', handleFirstInteraction, { once: true });

  return () => {
    document.removeEventListener('pointerdown', handleFirstInteraction);
    document.removeEventListener('keydown', handleFirstInteraction);
  };
}

/**
 * 端末を振動させる。`navigator.vibrate` 未実装環境（iOS 等）では
 * オプショナルチェイニングにより何もしない（throw しない）。
 */
export function vibrateMatchCall(): void {
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch (error) {
    console.error('[matchCallAlert] vibrateMatchCall failed:', error);
  }
}

/**
 * 呼び出し通知の音・振動を発火する単一の入口。
 * 設定（`matchCallAlert`）が ON のときだけ実行する。
 */
export function fireMatchCallAlert(): void {
  if (!useSettingsStore.getState().matchCallAlert) return;
  playMatchCallChime();
  vibrateMatchCall();
}
