/**
 * 孤勇 demo 录音（自托管 MP3）播放的**状态机**回归测试。
 *
 * 覆盖 Codex 审查指出的盲点：Chrome 真机验证只覆盖 happy-path，无自动化回归防状态机漂移。
 * jsdom 无真实媒体解码，故 stub `HTMLMediaElement.play/pause`（play 返回可控 Promise），
 * 只验证组件对媒体事件/Promise 的**状态反应**，不验证真实音频解码（那是浏览器职责）。
 *
 * 用例：
 *  1. 点「播放录音」→ play() resolve → 进入播放态（按钮「停止录音」、audio.play 被调）。
 *  2. play() reject（autoplay 被拒）→ 不留假「已播放」状态（按钮仍「播放录音」）。
 *  3. 播放中点「停止录音」→ pause 被调 + currentTime 归零 + 回「播放录音」。
 *  4. 播放中切换触发词变体 → stopRecording 触发（pause + 归零）。
 *  5. 媒体 `ended` 事件 → UI 复位为「播放录音」。
 *  6. 媒体 `pause` 事件（独立触发，不经 stopRecording）→ onPause 单独复位 UI。
 *  7. 「无条件归零」边界：录音被外部暂停（paused=true）后停止，仍把 currentTime 归零。
 *
 * 不覆盖「pending play 期间快速双击」竞态——jsdom 同步桩无法忠实复现浏览器 AbortError
 * 拒绝时序，强测只会产生假阳性；详见对应位置注释。
 */
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 引擎重且依赖 WASM/真解析——本测试只关心录音状态机，故最小 mock，让 compiled.ok=true、
// runOnce 能跑通（返回可预测值）。IdentifierKind/ZH_CN 供 config 静态引用。
vi.mock('@aster-cloud/aster-lang-ts/browser', () => ({
  compile: vi.fn(() => ({ success: true, core: { kind: 'mock-core' }, parseErrors: [] })),
  evaluate: vi.fn(() => ({ success: true, value: '我亦不回头' })),
  canonicalize: vi.fn(() => '模块 入夜的城。'),
  vocabularyRegistry: { registerCustom: vi.fn() },
  initBuiltinVocabularies: vi.fn(),
  ZH_CN: { id: 'zh-CN' },
  IdentifierKind: { LITERAL: 'LITERAL' },
}));

// cn 用真实实现会拉整个 ui barrel（重）；本测试只需拼 class，mock 成 join 即可。
vi.mock('@/components/ui', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { GuyongDemoContent } from '@/app/[locale]/demos/guyong/guyong-content';

// ── jsdom 媒体桩：jsdom 未实现 play/pause，需自行安装可控桩 ──────────────────────
let playSpy: ReturnType<typeof vi.fn>;
let pauseSpy: ReturnType<typeof vi.fn>;
let playResolves: boolean;

// 原型上被覆写的原始描述符（play/pause/paused）——afterAll 精确还原，避免跨文件污染
// （Codex 审查：测试隔离加固）。jsdom 未实现这些，descriptor 通常为 undefined。
const ORIGINAL_DESCRIPTORS = {
  play: Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'play'),
  pause: Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'pause'),
  paused: Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'paused'),
};

beforeEach(() => {
  playResolves = true;
  playSpy = vi.fn(() =>
    playResolves ? Promise.resolve() : Promise.reject(new DOMException('blocked', 'NotAllowedError')),
  );
  pauseSpy = vi.fn(function (this: HTMLMediaElement) {
    // 真实 pause 会把 paused 置 true 并派发 pause 事件；这里模拟这两点。
    Object.defineProperty(this, 'paused', { configurable: true, value: true });
    this.dispatchEvent(new Event('pause'));
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: playSpy,
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: pauseSpy,
  });
  // 初始 paused=true（未播放）。play() 成功后把 paused 置 false 供 toggle 的分支判断。
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, value: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

afterAll(() => {
  // 精确还原原型描述符：有原始描述符则恢复，本就没有（jsdom 未实现）则删除我们加的。
  for (const [prop, desc] of Object.entries(ORIGINAL_DESCRIPTORS)) {
    if (desc) Object.defineProperty(HTMLMediaElement.prototype, prop, desc);
    else delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>)[prop];
  }
});

/** 取录音 <audio> 元素（组件里唯一的 audio）。 */
function getAudio(container: HTMLElement): HTMLAudioElement {
  const el = container.querySelector('audio');
  if (!el) throw new Error('no <audio> element rendered');
  return el as HTMLAudioElement;
}

/** 播放成功后把 paused 翻成 false（模拟真实媒体元素状态转移）。 */
function markPlaying(audio: HTMLAudioElement) {
  Object.defineProperty(audio, 'paused', { configurable: true, value: false });
}

describe('GuyongDemoContent · 录音播放状态机', () => {
  it('点「播放录音」→ play() resolve → 进入播放态', async () => {
    const { container } = render(<GuyongDemoContent />);
    const audio = getAudio(container);
    const btn = screen.getByRole('button', { name: /播放录音/ });

    await act(async () => {
      fireEvent.click(btn);
      markPlaying(audio); // play() 成功，媒体转为非暂停
    });

    expect(playSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: /停止录音/ })).toBeTruthy());
    expect(screen.getByRole('button', { name: /停止录音/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('play() reject（autoplay 被拒）→ 不留假「已播放」状态', async () => {
    playResolves = false;
    render(<GuyongDemoContent />);
    const btn = screen.getByRole('button', { name: /播放录音/ });

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(playSpy).toHaveBeenCalledTimes(1);
    // 被拒后状态回滚：按钮仍是「播放录音」，aria-pressed=false。
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /播放录音/ }).getAttribute('aria-pressed')).toBe('false'),
    );
  });

  it('播放中点「停止录音」→ pause 被调 + currentTime 归零 + 回「播放录音」', async () => {
    const { container } = render(<GuyongDemoContent />);
    const audio = getAudio(container);
    audio.currentTime = 42; // 假装播到中途

    const playBtn = screen.getByRole('button', { name: /播放录音/ });
    await act(async () => {
      fireEvent.click(playBtn);
      markPlaying(audio);
    });
    await waitFor(() => screen.getByRole('button', { name: /停止录音/ }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /停止录音/ }));
    });

    expect(pauseSpy).toHaveBeenCalled();
    expect(audio.currentTime).toBe(0);
    expect(screen.getByRole('button', { name: /播放录音/ })).toBeTruthy();
  });

  it('播放中切换触发词变体 → 停止录音（pause + 归零）', async () => {
    const { container } = render(<GuyongDemoContent />);
    const audio = getAudio(container);
    audio.currentTime = 10;

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /播放录音/ }));
      markPlaying(audio);
    });
    await waitFor(() => screen.getByRole('button', { name: /停止录音/ }));

    // 切到另一个触发词变体（「不停走」）。
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '不停走' }));
    });

    expect(pauseSpy).toHaveBeenCalled();
    expect(audio.currentTime).toBe(0);
    expect(screen.getByRole('button', { name: /播放录音/ })).toBeTruthy();
  });

  it('媒体 ended 事件 → UI 复位为「播放录音」', async () => {
    const { container } = render(<GuyongDemoContent />);
    const audio = getAudio(container);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /播放录音/ }));
      markPlaying(audio);
    });
    await waitFor(() => screen.getByRole('button', { name: /停止录音/ }));

    await act(async () => {
      fireEvent(audio, new Event('ended'));
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /播放录音/ }).getAttribute('aria-pressed')).toBe('false'),
    );
  });

  it('媒体 pause 事件（独立触发）→ onPause 复位 UI', async () => {
    // 独立验证 onPause handler：不经 stopRecording（那会额外显式 setRecPlaying(false)，
    // 掩盖 onPause 是否真的生效）。直接派发 pause 事件，断言 UI 仅靠 onPause 就复位。
    // 这修掉「文件说明称覆盖 pause 但无独立用例」的覆盖-诚实缺口（Codex 审查）。
    const { container } = render(<GuyongDemoContent />);
    const audio = getAudio(container);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /播放录音/ }));
      markPlaying(audio);
    });
    await waitFor(() => screen.getByRole('button', { name: /停止录音/ }));

    // 外部（非按钮）暂停：只派发 pause 事件，不调 stopRecording。
    await act(async () => {
      fireEvent(audio, new Event('pause'));
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /播放录音/ }).getAttribute('aria-pressed')).toBe('false'),
    );
  });

  // ★不覆盖「pending play 期间点停止」的快速双击竞态：真实浏览器里 play() 会**同步**把
  //   paused 置 false、pause() 以 AbortError **拒绝** pending 的 play Promise（组件 catch 保持
  //   false）。这套 jsdom 同步桩无法忠实复现该浏览器内部时序（pause 无法拒绝一个我们自己
  //   持有的 pending Promise），强测只会断言桩特有行为而非真实行为（假阳性）。Codex 审查亦
  //   将其列为「以后可加」的非阻塞加固，且判定当前生产实现在真实语义下已正确。故此处不放
  //   不忠实的用例，避免误导性绿灯。

  it('「无条件归零」边界：外部暂停后停止仍把 currentTime 归零', async () => {
    const { container } = render(<GuyongDemoContent />);
    const audio = getAudio(container);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /播放录音/ }));
      markPlaying(audio);
    });
    await waitFor(() => screen.getByRole('button', { name: /停止录音/ }));

    // 外部（系统媒体控件 / 页面生命周期）把录音停在中途：paused=true 但 currentTime 未归零。
    audio.currentTime = 88;
    Object.defineProperty(audio, 'paused', { configurable: true, value: true });

    // 此时切换变体 → stopRecording 应无条件归零（即便已 paused）。
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '不弃守' }));
    });

    expect(audio.currentTime).toBe(0);
  });
});
