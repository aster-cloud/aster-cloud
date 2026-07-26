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

  /** 播放整段（主旋律 + 合唱背景）。若已在播放则先停。 */
  play(): void {
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
      this.timers.push(window.setTimeout(() => this.onLine(lineIndex), Math.max(0, delayMs)));

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

  /** 主旋律单音（男声独唱色）：锯齿波 + 低通滤波（做暖 formant）+ ADSR，接 master。 */
  private scheduleLead(freq: number, start: number, dur: number): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, start);

    // 低通滤波：截频跟随音高上移，模拟人声共振峰的暖色（去掉锯齿的尖锐高次谐波）。
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(3200, freq * 3.2), start);
    lp.Q.setValueAtTime(6, start);

    const g = this.ctx.createGain();
    const attack = 0.02, release = Math.min(0.14, dur * 0.45), peak = 0.9;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + attack);
    g.gain.setValueAtTime(peak, start + Math.max(attack, dur - release));
    g.gain.linearRampToValueAtTime(0, start + dur);

    osc.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    osc.start(start);
    osc.stop(start + dur + 0.02);
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
