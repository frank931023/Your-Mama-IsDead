/**
 * Web Audio API 合成的鐘聲
 *
 * 用兩個正弦波震盪器(基頻 + 八度泛音)+ 指數衰減包絡,
 * 合成出類似寺廟銅鐘的「叮——」聲。完全不需音檔,
 * 也不需網路請求,毫秒級就能播放,適合儀式互動回饋。
 *
 * 第一次呼叫會延遲建立 AudioContext(瀏覽器 autoplay policy
 * 要求須由使用者互動觸發)。
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  try {
    const Constructor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Constructor();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * 播放一聲鐘響。
 * @param freq 基頻 Hz,廟鐘範圍約 220~330,預設 261(中央 C)
 * @param duration 衰減時間秒數,預設 4 秒
 * @param volume 0..1
 */
export function playBell(freq = 261, duration = 4, volume = 0.4): void {
  const audio = getCtx();
  if (!audio) return;
  // suspended 狀態要先 resume(瀏覽器 policy)
  if (audio.state === "suspended") {
    void audio.resume();
  }
  const now = audio.currentTime;

  // 基頻 + 八度,讓音色有金屬感
  const fundamental = audio.createOscillator();
  fundamental.type = "sine";
  fundamental.frequency.value = freq;

  const overtone = audio.createOscillator();
  overtone.type = "sine";
  overtone.frequency.value = freq * 2.01; // 略偏離整數倍頻,模擬鐘體不規則振動

  const overtoneHigh = audio.createOscillator();
  overtoneHigh.type = "sine";
  overtoneHigh.frequency.value = freq * 3.03;

  // 包絡:瞬間升到峰值 → 指數衰減
  const env = audio.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(volume, now + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  // 高泛音衰減更快
  const envHigh = audio.createGain();
  envHigh.gain.setValueAtTime(0, now);
  envHigh.gain.linearRampToValueAtTime(volume * 0.3, now + 0.01);
  envHigh.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.6);

  fundamental.connect(env);
  overtone.connect(env);
  overtoneHigh.connect(envHigh);
  env.connect(audio.destination);
  envHigh.connect(audio.destination);

  fundamental.start(now);
  overtone.start(now);
  overtoneHigh.start(now);
  fundamental.stop(now + duration);
  overtone.stop(now + duration);
  overtoneHigh.stop(now + duration);
}
