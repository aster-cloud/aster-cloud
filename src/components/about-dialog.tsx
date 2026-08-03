'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * 「关于」版本信息弹框（用户菜单 → 帮助）。
 *
 * <p>纯展示，无副作用。版本数据由调用方传入：
 * <ul>
 *   <li>app/engine/messages —— build 期由 next.config 从 package.json inline
 *       （见 NEXT_PUBLIC_APP_VERSION 等），即**这个部署实际锁的版本**；</li>
 *   <li>api —— 服务端向后端 /api/v1/version 取，取不到传 null（显示「不可用」，
 *       不让弹框整体失败：版本展示不该因后端抖动而挡住用户）。</li>
 * </ul>
 */
export interface AboutDialogLabels {
  title: string;
  version: string;
  build: string;
  engine: string;
  messages: string;
  apiVersion: string;
  unavailable: string;
  close: string;
}

export interface AboutVersions {
  app: string;
  build: string;
  engine: string;
  messages: string;
  /** 后端引擎版本；null = 取不到（显示 labels.unavailable）。 */
  api: string | null;
}

export function AboutDialog({
  labels,
  versions,
  onClose,
}: {
  labels: AboutDialogLabels;
  versions: AboutVersions;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Esc 关闭 + 打开时把焦点移到关闭按钮（键盘用户不必 tab 穿过整页）。
  useEffect(() => {
    closeRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const rows: Array<{ label: string; value: string }> = [
    { label: labels.version, value: versions.app },
    { label: labels.build, value: versions.build },
    { label: labels.engine, value: versions.engine },
    { label: labels.messages, value: versions.messages },
    { label: labels.apiVersion, value: versions.api ?? labels.unavailable },
  ];

  const dialog = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-dialog-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-bg p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="about-dialog-title" className="mb-4 text-lg font-semibold text-fg">
          {labels.title}
        </h2>
        <dl className="space-y-2">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-fg-muted">{row.label}</dt>
              {/* 版本号用等宽字体：短哈希/点分版本对齐更易读，也便于人工比对。 */}
              <dd className="font-mono text-sm text-fg break-all text-right">{row.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 flex justify-end">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-md border border-border-strong px-4 py-2 text-sm font-medium text-fg hover:bg-bg-subtle focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {labels.close}
          </button>
        </div>
      </div>
    </div>
  );

  // ★必须 portal 到 body：本组件渲染在 UserDropdown 的 <div className="relative"> 内，
  //   祖先若带 transform/backdrop-filter 会创建新的 containing block，使
  //   `fixed inset-0` 相对该祖先而非视口定位——实测表现为弹框贴着头像下拉、顶部被裁出屏幕
  //   （浏览器截图实测确认，非静态推理）。portal 后脱离任何祖先层叠上下文。
  //   本组件是 'use client' 且仅在用户点击后挂载，document 必然存在，无需 mounted 门。
  return createPortal(dialog, document.body);
}
