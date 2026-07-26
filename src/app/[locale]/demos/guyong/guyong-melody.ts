/**
 * 《孤勇》原创旋律 —— 纯 Web Audio 合成（AudioContext + OscillatorNode），零外部资源、CSP 友好
 * （同 cat-mood 零资源路线：不引入任何音频文件、不发网络请求，声音全在浏览器内实时合成）。
 *
 * ★原创声明：旋律与和声均为本项目原创、从零谱写，配本项目原创的《孤勇》歌词；不取自、不改编任何既有乐曲。
 *
 * ★音色说明（诚实）：纯合成无法产生真人唱声/唱词。本模块用**合成音色近似**「男声独唱 + 宽合唱背景」的
 *   织体——不是真人歌声：
 *   - 主旋律（“男声独唱色”）：男声音域（低八度）+ 锯齿波经低通滤波做出的 formant 暖色，单声部领唱。
 *   - 背景（“宽合唱 pad”）：主旋律的三和弦铺底，多声部叠加 + 轻微失谐（unison detune）作出合唱般的宽厚壮阔感。
 *
 * 每个音符 = MIDI 音高 + 时值（拍）。BPM 88 下整段约 ~30s，五乐句对应显示层五行诗，供逐行跟唱高亮。
 */

/** 一个音符：MIDI 音高（用于算频率）+ 时值（拍，1 = 一个四分音符）。休止符 pitch = null。 */
interface Note {
  pitch: number | null;
  beats: number;
}

/** MIDI 音高 → 频率（Hz）。A4(69)=440Hz，十二平均律。 */
function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// D 大调五声音阶音高（MIDI）。原创旋律，按显示层五行诗分句，每行末拖长音收句。
const D4 = 62, E4 = 64, FS4 = 66, A4 = 69, B4 = 71, D5 = 74, E5 = 76, A3 = 57, B3 = 59;

/** 原创旋律谱（我的原创）。按诗五行分 5 乐句，每句末拖长音。整体≈28 拍，BPM 88 下约 ~30s。 */
const PHRASES: Note[][] = [
  [ // 「孤身入夜的城，」
    { pitch: A3, beats: 0.5 }, { pitch: B3, beats: 0.5 }, { pitch: D4, beats: 0.5 },
    { pitch: E4, beats: 0.5 }, { pitch: FS4, beats: 1 }, { pitch: E4, beats: 1.5 },
  ],
  [ // 「我曾问归途，心里记着：」
    { pitch: D4, beats: 0.5 }, { pitch: E4, beats: 0.5 }, { pitch: FS4, beats: 0.5 },
    { pitch: A4, beats: 0.5 }, { pitch: B4, beats: 1 }, { pitch: A4, beats: 0.5 },
    { pitch: FS4, beats: 0.5 }, { pitch: E4, beats: 1.5 },
  ],
  [ // 「灯，是那盏『远方的灯』；」
    { pitch: A4, beats: 1 }, { pitch: B4, beats: 0.5 }, { pitch: D5, beats: 0.5 },
    { pitch: E5, beats: 1 }, { pitch: D5, beats: 0.5 }, { pitch: B4, beats: 0.5 },
    { pitch: A4, beats: 1.5 },
  ],
  [ // 「路，是这条『脚下的路』。」
    { pitch: FS4, beats: 1 }, { pitch: A4, beats: 0.5 }, { pitch: B4, beats: 0.5 },
    { pitch: D5, beats: 1 }, { pitch: B4, beats: 0.5 }, { pitch: A4, beats: 0.5 },
    { pitch: FS4, beats: 1.5 },
  ],
  [ // 「我只答一句：不回头。」
    { pitch: E4, beats: 0.5 }, { pitch: FS4, beats: 0.5 }, { pitch: A4, beats: 0.5 },
    { pitch: B4, beats: 0.5 }, { pitch: A4, beats: 1 }, { pitch: FS4, beats: 1 },
    { pitch: D4, beats: 2 },
  ],
];

const BPM = 88;
const SECONDS_PER_BEAT = 60 / BPM;

/** 大三和弦（半音偏移：根/大三/纯五），用于背景合唱 pad 的和声铺底。 */
const CHORD_OFFSETS = [0, 4, 7];
/** 合唱 pad 每个声部的 unison 失谐（分音，cents），叠出宽厚合唱感。 */
const CHOIR_DETUNE_CENTS = [-7, 0, 7];

/**
 * 男声「啊」元音的共振峰（formant）——F1/F2/F3 中心频率(Hz)、带宽(Hz)、相对增益。
 * 用三条并联带通滤波把锯齿声源塑成人声色（近似 /a/ 元音，男声偏低）。这是**无词人声**合成：
 * 出「啊」的元音音色，不唱真实字词（真实字词需声样=外部资源，与零资源矛盾）。
 */
const VOICE_FORMANTS: { freq: number; bw: number; gain: number }[] = [
  { freq: 700, bw: 110, gain: 1.0 }, // F1
  { freq: 1180, bw: 130, gain: 0.55 }, // F2
  { freq: 2600, bw: 180, gain: 0.35 }, // F3
];

/** 播放器状态回调：当前正在唱第几行诗（0-based），停止时为 null。 */
export type LineCallback = (lineIndex: number | null) => void;

/**
 * 《孤勇》原创旋律播放器。纯 Web Audio，惰性建 AudioContext（首次 play 时，满足浏览器手势策略）。
 * play() 合成两层（男声独唱色主旋律 + 宽合唱 pad 背景）并调度；stop()/自然结束都走同一 teardown
 * 做完整资源回收（清定时器、淡出、关 ctx），无泄漏。onLine 回调驱动 UI 逐行跟唱高亮。
 */
export class GuyongMelodyPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private timers: number[] = [];
  private onLine: LineCallback;
  private playing = false;

  constructor(onLine: LineCallback) {
    this.onLine = onLine;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /**
   * 播放整段（主旋律 + 合唱背景）。若已在播放则先停。
   * @param lyricLines 可选：五行歌词（= 显示层五行）。传入时用浏览器 SpeechSynthesis 逐行**朗读**歌词
   *   （有词人声，零外部资源=系统内置 TTS）。诚实边界：TTS 是「读/念」非「唱」，不跟旋律音高；
   *   与器乐旋律 + 无词 formant 人声同时播放，形成「有词人声 + 配乐」。为空则只播旋律（无词）。
   */
  play(lyricLines?: string[]): void {
    this.teardown(); // 清掉上一次的残留（幂等）
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.16; // 两层叠加，整体音量偏小柔和
    this.master.connect(this.ctx.destination);

    this.playing = true;
    let t = this.ctx.currentTime + 0.05;

    PHRASES.forEach((phrase, lineIndex) => {
      const phraseStart = t;
      const delayMs = (phraseStart - this.ctx!.currentTime) * 1000;
      this.timers.push(
        window.setTimeout(() => {
          this.onLine(lineIndex);
          // 有词人声：该乐句开始时朗读对应歌词行（与旋律同步）。
          const line = lyricLines?.[lineIndex];
          if (line) this.speakLine(line);
        }, Math.max(0, delayMs)),
      );

      for (const note of phrase) {
        const dur = note.beats * SECONDS_PER_BEAT;
        if (note.pitch !== null) {
          // 主旋律：男声独唱色（低八度 + 滤波锯齿暖色）。
          this.scheduleLead(midiToFreq(note.pitch - 12), t, dur);
          // 背景：宽合唱 pad（大三和弦 × 多声部失谐，柔起收，音量更低不抢主旋律）。
          for (const semi of CHORD_OFFSETS) {
            this.scheduleChoir(midiToFreq(note.pitch - 12 + semi), t, dur);
          }
        }
        t += dur;
      }
    });

    // 自然结束：走同一 teardown（★修 Codex 复审：原实现只清高亮不关 ctx = 资源泄漏）。
    const endMs = (t - this.ctx.currentTime) * 1000 + 200;
    this.timers.push(window.setTimeout(() => this.teardown(), Math.max(0, endMs)));
  }

  /** 立即停止：走同一 teardown。 */
  stop(): void {
    this.teardown();
  }

  /**
   * 唯一的资源回收路径（stop 与自然结束共用）：清所有定时器、淡出 master、关闭 ctx、复位状态、清高亮。
   * 幂等：ctx 已空则只复位状态。★这是 Codex 复审要求的「完整生命周期闭环」。
   */
  private teardown(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers = [];
    // 取消任何在读的歌词 TTS（防停止后仍念完残句）。
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setValueAtTime(this.master.gain.value, this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.03);
    }
    const ctx = this.ctx;
    if (ctx) window.setTimeout(() => void ctx.close(), 60);
    this.ctx = null;
    this.master = null;
    const wasPlaying = this.playing;
    this.playing = false;
    if (wasPlaying) this.onLine(null);
  }

  /**
   * 有词人声：用浏览器 SpeechSynthesis 朗读一行歌词（零外部资源=系统内置 TTS）。
   * 诚实边界：这是「读/念」非「唱」——不跟旋律音高、语调受系统嗓音限制、各浏览器嗓音不一；
   * 与器乐旋律 + 无词 formant 人声同时播，构成「有词人声 + 配乐」。选中文嗓音，语速略慢配诗句。
   */
  private speakLine(line: string): void {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(line);
    u.lang = 'zh-CN';
    u.rate = 0.85; // 略慢，贴合诗句吟诵
    u.pitch = 0.9; // 稍低，偏男声
    u.volume = 1;
    // 优先选中文嗓音（有则用；无则用系统默认，仍按 zh-CN 尽力发音）。
    const zh = window.speechSynthesis.getVoices().find((v) => /zh|cmn|Chinese/i.test(v.lang));
    if (zh) u.voice = zh;
    window.speechSynthesis.speak(u);
  }

  /**
   * 主旋律单音——**无词人声**（男声「啊」元音）：锯齿声源(近似声带谐波) → 三条并联带通共振峰
   * (F1/F2/F3) 塑元音色 → ADSR。加轻微 vibrato(~5.5Hz)使更像真人歌唱。接 master。
   * 出的是人声「啊」的音色（明显像人声而非乐器），不唱真实字词。所有振荡器 stop > start，时间单调。
   */
  private scheduleLead(freq: number, start: number, dur: number): void {
    if (!this.ctx || !this.master) return;
    const stopAt = start + dur + 0.02;

    // 声带谐波源：锯齿富含谐波，供共振峰塑形。
    const source = this.ctx.createOscillator();
    source.type = 'sawtooth';
    source.frequency.setValueAtTime(freq, start);

    // 轻微 vibrato：LFO 调制 source.frequency（人声歌唱的自然颤音）。
    const vibrato = this.ctx.createOscillator();
    vibrato.type = 'sine';
    vibrato.frequency.setValueAtTime(5.5, start);
    const vibratoDepth = this.ctx.createGain();
    vibratoDepth.gain.setValueAtTime(freq * 0.006, start); // ~±0.6% 音高
    vibrato.connect(vibratoDepth);
    vibratoDepth.connect(source.frequency);

    // ADSR 包络（人声起收：稍慢起、明显收）。
    const env = this.ctx.createGain();
    const attack = 0.045, release = Math.min(0.18, dur * 0.5), peak = 0.85;
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(peak, start + attack);
    env.gain.setValueAtTime(peak, start + Math.max(attack, dur - release));
    env.gain.linearRampToValueAtTime(0, start + dur);
    env.connect(this.master);

    // 三条并联共振峰带通：把锯齿塑成「啊」元音的人声色。
    for (const f of VOICE_FORMANTS) {
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(f.freq, start);
      bp.Q.setValueAtTime(f.freq / f.bw, start); // Q = 中心频率 / 带宽
      const fg = this.ctx.createGain();
      fg.gain.setValueAtTime(f.gain, start);
      source.connect(bp);
      bp.connect(fg);
      fg.connect(env);
    }

    source.start(start);
    source.stop(stopAt);
    vibrato.start(start);
    vibrato.stop(stopAt);
  }

  /** 背景合唱单音（宽 pad 的一个声部）：三角波 × unison 失谐叠加，柔起收，音量低。 */
  private scheduleChoir(freq: number, start: number, dur: number): void {
    if (!this.ctx || !this.master) return;
    const g = this.ctx.createGain();
    const attack = 0.08, release = Math.min(0.25, dur * 0.5), peak = 0.28;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + attack);
    g.gain.setValueAtTime(peak, start + Math.max(attack, dur - release));
    g.gain.linearRampToValueAtTime(0, start + dur);
    g.connect(this.master);

    // 多声部 unison 失谐 → 合唱般宽厚。
    for (const cents of CHOIR_DETUNE_CENTS) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);
      osc.detune.setValueAtTime(cents, start);
      osc.connect(g);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    }
  }
}

/** 供 UI 展示：诗共几行（= 乐句数），用于「逐行高亮」渲染。 */
export const GUYONG_MELODY_LINE_COUNT = PHRASES.length;
