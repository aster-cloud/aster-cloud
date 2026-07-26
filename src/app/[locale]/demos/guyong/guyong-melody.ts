/**
 * 《孤勇》原创旋律 —— 纯 Web Audio 合成（AudioContext + OscillatorNode），零外部资源、CSP 友好
 * （同 cat-mood 零资源路线：不引入任何音频文件、不发网络请求，声音全在浏览器内实时合成）。
 *
 * ★旋律原创声明：本旋律为本项目原创、从零谱写，配本项目原创的《孤勇》歌词；不取自、不改编任何既有乐曲。
 *
 * 设计：五声音阶（宫商角徵羽，D 大调 pentatonic）铺一段孤勇气质的原创旋律，逐句对应显示层五行诗。
 * 每个音符 = 频率（Hz）+ 时值（拍）；播放时用三角波（近笛/箫的柔和音色）+ ADSR 包络，避免爆音。
 * 暴露 GuyongMelodyPlayer：play/stop/当前行回调，供 UI 做「跟唱高亮」与播放控制。
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

// D 大调五声音阶音高（MIDI）：D4=62, E4=64, F#4=66, A4=69, B4=71, D5=74, E5=76 …
// 原创旋律，按显示层五行诗分句。每行末拖长音收句（配诗句停顿）。
const D4 = 62, E4 = 64, FS4 = 66, A4 = 69, B4 = 71, D5 = 74, E5 = 76, A3 = 57, B3 = 59;

/**
 * 原创旋律谱（我的原创）。按诗五行分为 5 个乐句（phrase），每句末拖长音。
 * 音符数≈每行字数，供「逐字/逐行」跟唱。整体约 28–32 拍，BPM 88 下约 ~30s。
 */
const PHRASES: Note[][] = [
  // 「孤身入夜的城，」——起句低回
  [
    { pitch: A3, beats: 0.5 }, { pitch: B3, beats: 0.5 }, { pitch: D4, beats: 0.5 },
    { pitch: E4, beats: 0.5 }, { pitch: FS4, beats: 1 }, { pitch: E4, beats: 1.5 },
  ],
  // 「我曾问归途，心里记着：」——上行铺陈
  [
    { pitch: D4, beats: 0.5 }, { pitch: E4, beats: 0.5 }, { pitch: FS4, beats: 0.5 },
    { pitch: A4, beats: 0.5 }, { pitch: B4, beats: 1 }, { pitch: A4, beats: 0.5 },
    { pitch: FS4, beats: 0.5 }, { pitch: E4, beats: 1.5 },
  ],
  // 「灯，是那盏『远方的灯』；」——高处点题
  [
    { pitch: A4, beats: 1 }, { pitch: B4, beats: 0.5 }, { pitch: D5, beats: 0.5 },
    { pitch: E5, beats: 1 }, { pitch: D5, beats: 0.5 }, { pitch: B4, beats: 0.5 },
    { pitch: A4, beats: 1.5 },
  ],
  // 「路，是这条『脚下的路』。」——对句回落
  [
    { pitch: FS4, beats: 1 }, { pitch: A4, beats: 0.5 }, { pitch: B4, beats: 0.5 },
    { pitch: D5, beats: 1 }, { pitch: B4, beats: 0.5 }, { pitch: A4, beats: 0.5 },
    { pitch: FS4, beats: 1.5 },
  ],
  // 「我只答一句：不回头。」——收句坚定，落主音
  [
    { pitch: E4, beats: 0.5 }, { pitch: FS4, beats: 0.5 }, { pitch: A4, beats: 0.5 },
    { pitch: B4, beats: 0.5 }, { pitch: A4, beats: 1 }, { pitch: FS4, beats: 1 },
    { pitch: D4, beats: 2 },
  ],
];

const BPM = 88;
const SECONDS_PER_BEAT = 60 / BPM;

/** 播放器状态回调：当前正在唱第几行诗（0-based），停止时为 null。 */
export type LineCallback = (lineIndex: number | null) => void;

/**
 * 《孤勇》原创旋律播放器。纯 Web Audio，惰性建 AudioContext（首次 play 时，满足浏览器手势策略）。
 * play() 从头合成整段旋律并调度；stop() 立即静音；onLine 回调驱动 UI 逐行高亮。
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

  /** 播放整段原创旋律。若已在播放则先停。 */
  play(): void {
    this.stop();
    // 惰性建 ctx（首次用户手势内），兼容 webkit 前缀。
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.18; // 整体音量偏小，柔和不刺耳
    this.master.connect(this.ctx.destination);

    this.playing = true;
    let t = this.ctx.currentTime + 0.05;

    PHRASES.forEach((phrase, lineIndex) => {
      const phraseStart = t;
      // 该乐句开始时高亮对应诗行（用 setTimeout 对齐音频时钟）。
      const delayMs = (phraseStart - this.ctx!.currentTime) * 1000;
      this.timers.push(window.setTimeout(() => this.onLine(lineIndex), Math.max(0, delayMs)));

      for (const note of phrase) {
        const dur = note.beats * SECONDS_PER_BEAT;
        if (note.pitch !== null) {
          this.scheduleNote(midiToFreq(note.pitch), t, dur);
        }
        t += dur;
      }
    });

    // 结束：清高亮 + 标记停止。
    const endMs = (t - this.ctx.currentTime) * 1000;
    this.timers.push(
      window.setTimeout(() => {
        this.onLine(null);
        this.playing = false;
      }, Math.max(0, endMs)),
    );
  }

  /** 立即停止：清所有定时器、静音、关闭 ctx。 */
  stop(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers = [];
    if (this.master && this.ctx) {
      // 快速淡出避免爆音。
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setValueAtTime(this.master.gain.value, this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.03);
    }
    const ctx = this.ctx;
    if (ctx) window.setTimeout(() => void ctx.close(), 60);
    this.ctx = null;
    this.master = null;
    if (this.playing) this.onLine(null);
    this.playing = false;
  }

  /** 单音符：三角波 + ADSR 包络（柔和起收，防爆音），接到 master。 */
  private scheduleNote(freq: number, start: number, dur: number): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, start);

    const g = this.ctx.createGain();
    const attack = 0.015, release = Math.min(0.12, dur * 0.4);
    const peak = 1;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + attack);
    g.gain.setValueAtTime(peak, start + Math.max(attack, dur - release));
    g.gain.linearRampToValueAtTime(0, start + dur);

    osc.connect(g);
    g.connect(this.master);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }
}

/** 供 UI 展示：诗共几行（= 乐句数），用于「逐行高亮」渲染。 */
export const GUYONG_MELODY_LINE_COUNT = PHRASES.length;
