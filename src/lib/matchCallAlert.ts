/**
 * 呼び出し通知に付随する音・振動・読み上げユーティリティ。
 *
 * OS 通知（`notifications.ts`）とは独立に、アプリを開いている端末で確実に
 * 気づけるよう WebAudio のビープ音と `navigator.vibrate`、`speechSynthesis`
 * による読み上げを鳴らす。オフラインでも動くよう音声ファイルは使わず
 * WebAudio で生成する。
 */
import { useSettingsStore } from '../stores/settingsStore';

type AudioContextConstructor = typeof AudioContext;

/** モジュールシングルトンの AudioContext。unlock 時に遅延生成する。 */
let audioContext: AudioContext | null = null;

/**
 * ページがバックグラウンド（非表示）かどうか。
 *
 * hidden 中の音・振動・読み上げは「今は鳴らない代わりに復帰時へずれ込む」挙動を
 * 取る（iOS の `speechSynthesis` は発話をキューに積んだまま保留し visible 復帰で
 * まとめて再生する。WebAudio も AudioContext が suspend されると同様）。その結果
 * とっくに始まった試合の呼び出しが数分後に鳴るため、hidden 中は鳴らさない。
 * バックグラウンドの人へ気づかせる役割は OS 通知（`notifications.ts`）が担う。
 * 詳細: docs/plans/2026-08-22-match-call-stale-audio-on-resume.md
 */
function isPageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

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
    primeSpeechSynthesis();
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

/** チャイムの直後に続けて読み上げるための間隔。チャイム（0.3 秒）の末尾とわずかに重なるが、間延びを避けるためこの値にしている（ms）。 */
export const SPEECH_DELAY_MS = 200;

/**
 * 読み上げ中の画面タップでキャンセルするための `pointerdown` リスナー。
 * `speakMatchCall()` 実行中のみ非 null。連続呼び出し時に前回分が残らないよう
 * 発話開始のたびに前回のリスナーを解除してから新しく登録する。
 */
let activeCancelOnTapListener: (() => void) | null = null;

/**
 * チャイム後 `SPEECH_DELAY_MS` 待ってから読み上げるための `setTimeout` ID。
 * 待っている間にバックグラウンドへ回ったら捨てられるよう保持する。
 */
let pendingSpeechTimeoutId: ReturnType<typeof setTimeout> | null = null;

function removeCancelOnTapListener(): void {
  if (!activeCancelOnTapListener) return;
  document.removeEventListener('pointerdown', activeCancelOnTapListener);
  activeCancelOnTapListener = null;
}

/**
 * 読み上げ中の `speechSynthesis` を止める。リスナー解除もあわせて行う。
 * `speakMatchCall()` の画面タップキャンセルと共通化するためエクスポートし、
 * テストや将来の呼び出し元（他のキャンセル導線）からも使えるようにする。
 * 未対応環境・失敗時は throw しない。
 */
export function cancelMatchCallSpeech(): void {
  if (pendingSpeechTimeoutId !== null) {
    clearTimeout(pendingSpeechTimeoutId);
    pendingSpeechTimeoutId = null;
  }
  removeCancelOnTapListener();
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch (error) {
    console.error('[matchCallAlert] cancelMatchCallSpeech failed:', error);
  }
}

/**
 * `speechSynthesis` で読み上げる。未対応環境・失敗時は黙って何もしない
 * （throw しない）。発話前に `cancel()` して読み上げの積み残しを消す。
 *
 * 読み上げ中に画面のどこかをタップしたら即座に止められるよう、`speak()` の
 * 呼び出しと同時（同期的に、同じタイミングで）に `document` へ `pointerdown`
 * リスナーを登録する。`fireMatchCallAlert` / ベルのテスト再生はどちらも
 * `speak()` 自体を `setTimeout` で 200ms 遅らせて呼んでいるため、読み上げが
 * 実際に始まる時点では、きっかけとなった操作（ベルタップ等）の `pointerdown`
 * は既に発生し終わっている。リスナー登録を `speak()` と同じタイミングに
 * 揃えることで「ベルを押した瞬間に自分のタップでキャンセルされる」ことを防ぐ
 * ——このタイミングがずれると自タップキャンセルが再発するため、ここで揃える。
 *
 * 読み上げが自然に終わったとき（`onend`）・エラー時（`onerror`）はリスナーを
 * 解除する。リスナーが残り続けないことを保証するため、`{ once: true }` に
 * 頼らず `onend`/`onerror`/キャンセル実行時のいずれの経路でも明示的に
 * `removeEventListener` する。
 */
export function speakMatchCall(text: string): void {
  if (!text) return;
  if (!('speechSynthesis' in window)) return;
  // バックグラウンドでは speak() しない。積んだ発話が復帰時にまとめて再生され、
  // 終わった試合の呼び出しが後から読み上げられるため（`isPageHidden` 参照）。
  // チャイムの 200ms 後に読み上げる間にバックグラウンドへ回った場合もここで止まる。
  if (isPageHidden()) return;

  try {
    // 前回の発話が残っていれば、まずそのリスナーを解除してから cancel する。
    cancelMatchCallSpeech();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';

    const handleTapCancel = () => {
      // cancelMatchCallSpeech 内でリスナー解除も行われる。
      cancelMatchCallSpeech();
    };
    activeCancelOnTapListener = handleTapCancel;
    document.addEventListener('pointerdown', handleTapCancel);

    utterance.onend = () => {
      removeCancelOnTapListener();
    };
    utterance.onerror = () => {
      removeCancelOnTapListener();
    };

    window.speechSynthesis.speak(utterance);
  } catch (error) {
    console.error('[matchCallAlert] speakMatchCall failed:', error);
  }
}

/**
 * iOS のユーザー操作要件を満たすため、ごく短い無音の発話を一度流して
 * `speechSynthesis` をプライミングする。`unlockMatchCallAudio()` と同様、
 * ユーザー操作ハンドラから呼ぶことを想定。冪等（複数回呼んでも安全）で、
 * 失敗しても throw しない。
 */
export function primeSpeechSynthesis(): void {
  if (!('speechSynthesis' in window)) return;

  try {
    const utterance = new SpeechSynthesisUtterance('');
    utterance.volume = 0;
    window.speechSynthesis.speak(utterance);
  } catch (error) {
    console.error('[matchCallAlert] primeSpeechSynthesis failed:', error);
  }
}

/**
 * 呼び出し通知の音・振動・読み上げを発火する単一の入口。
 * 設定（`matchCallAlert`）が ON のときだけ実行する。
 * `speechText` を渡すとチャイム・振動に続けて読み上げる。体育館の騒音下では
 * ビープの方が通るため先に注意を引き、チャイム（0.3 秒）の末尾とわずかに重なるが
 * 間延びを避けるため `setTimeout` で 200ms 遅らせてから読み上げる。
 */
export function fireMatchCallAlert(speechText?: string): void {
  if (!useSettingsStore.getState().matchCallAlert) return;
  // バックグラウンド中は鳴らさない（`isPageHidden` 参照）。OS 通知は呼び出し側で
  // 別に出しているため、気づかせる経路自体は残る。
  if (isPageHidden()) return;
  playMatchCallChime();
  vibrateMatchCall();
  if (speechText) {
    pendingSpeechTimeoutId = setTimeout(() => {
      pendingSpeechTimeoutId = null;
      speakMatchCall(speechText);
    }, SPEECH_DELAY_MS);
  }
}

/**
 * バックグラウンドへ回った瞬間に読み上げを捨てるリスナーを登録する。
 *
 * `fireMatchCallAlert` / `speakMatchCall` の hidden ガードは「hidden 中に始める」
 * ことだけを防ぐので、visible 中に始まった読み上げがバックグラウンドへの移行を
 * またぐ経路が残る。iOS はこれを一時停止して visible 復帰時に再開するため、
 * hidden になった時点で `cancel()` し、保留中の `setTimeout` も捨てる。
 *
 * 戻り値はリスナーを解除するクリーンアップ関数（`useEffect` の戻り値にそのまま
 * 渡せる）。`installMatchCallAudioUnlock` と同じ流儀。
 */
export function installMatchCallSpeechHideGuard(): () => void {
  const handleVisibilityChange = () => {
    if (document.visibilityState !== 'hidden') return;
    cancelMatchCallSpeech();
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}
