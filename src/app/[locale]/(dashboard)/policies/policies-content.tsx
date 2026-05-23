'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { CLIENT_CAPABILITIES } from '@/hooks/use-deployment-mode';
import { formatDate } from '@/lib/format';
import { PolicyGroupTree, PolicyGroup } from '@/components/policy/policy-group-tree';
import { PolicyGroupDialog } from '@/components/policy/policy-group-dialog';
import { SharedWithMeSection } from '@/components/policy/shared-with-me-section';
import { ConfirmDialog } from '@/components/ui';
import { LoadingSkeleton } from '@/components/feedback/loading-skeleton';
import { ErrorState } from '@/components/feedback/error-state';
import {
  Folder,
  GripVertical,
  Plus,
  Snowflake,
  Trash2,
  ListChecks,
  Circle,
  FileText,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  ListSearchInput,
  buttonVariants,
  cn,
} from '@/components/ui';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  DragEndEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  CollisionDetection,
} from '@dnd-kit/core';

interface Policy {
  id: string;
  name: string;
  description: string | null;
  content: string;
  isPublic: boolean;
  piiFields: string[] | null;
  groupId: string | null;
  group: {
    id: string;
    name: string;
    icon: string | null;
    parentId: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
  isFrozen: boolean;
  _count: {
    executions: number;
  };
}

interface FreezeInfo {
  limit: number;
  total: number;
  frozenCount: number;
}

interface Translations {
  title: string;
  subtitle: string;
  newPolicy: string;
  trash: string;
  failedToLoad: string;
  failedToDelete: string;
  confirmDelete: string;
  freeze: {
    title: string;
    messageTemplate: string;
    upgradeLink: string;
    badge: string;
    cannotExecute: string;
    cannotEdit: string;
  };
  noPolicies: string;
  getStarted: string;
  piiFieldsTemplate: string;
  public: string;
  executionsTemplate: string;
  executeAction: string;
  edit: string;
  delete: string;
  updatedTemplate: string;
  groups: {
    allPolicies: string;
    ungrouped: string;
    newGroup: string;
    newSubgroup: string;
    edit: string;
    delete: string;
    policiesCount: string;
    createTitle: string;
    editTitle: string;
    nameLabel: string;
    namePlaceholder: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    save: string;
    cancel: string;
    deleteConfirm: string;
    deleteWarning: string;
    saving: string;
    deleting: string;
  };
}

// 简单模板插值
function formatTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
}

// 自定义碰撞检测：优先选择最内层（最小）的可放置区域
// 解决嵌套分组时无法拖放到子分组的问题
const smallestDroppableCollision: CollisionDetection = (args) => {
  // 首先使用 pointerWithin 获取所有包含指针的可放置区域
  const pointerCollisions = pointerWithin(args);

  if (pointerCollisions.length > 0) {
    // 按面积排序，选择最小的（最深嵌套的）
    const sorted = [...pointerCollisions].sort((a, b) => {
      const rectA = args.droppableRects.get(a.id);
      const rectB = args.droppableRects.get(b.id);
      if (!rectA || !rectB) return 0;
      const areaA = rectA.width * rectA.height;
      const areaB = rectB.width * rectB.height;
      return areaA - areaB; // 升序，最小的在前
    });
    return [sorted[0]]; // 返回最小的
  }

  // 如果 pointerWithin 没有结果，回退到 rectIntersection
  return rectIntersection(args);
};

// 可拖拽的策略项
interface DraggablePolicyItemProps {
  policy: Policy;
  locale: string;
  translations: Translations;
  onDelete: (policy: Policy) => void;
  isSelected: boolean;
  onToggleSelect: (policyId: string, event: React.MouseEvent) => void;
  selectedCount: number;
  isMultiSelectMode: boolean;
  isBeingDragged: boolean;
}

function DraggablePolicyItem({
  policy,
  locale,
  translations: t,
  onDelete,
  isSelected,
  onToggleSelect,
  selectedCount,
  isMultiSelectMode,
  isBeingDragged,
}: DraggablePolicyItemProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: policy.id,
    data: { type: 'policy', policy, isSelected, selectedCount },
  });

  // 判断该项是否应显示为占位符（当前正在拖拽且被选中）
  const showPlaceholder = isBeingDragged && isSelected;

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    opacity: isDragging ? 0.5 : 1,
  } : undefined;

  // 被选中且正在拖拽 → 显示骨架占位符（aria-live 让屏幕阅读器播报）
  if (showPlaceholder) {
    return (
      <li ref={setNodeRef} style={style}>
        <div
          className="rounded-md border-2 border-dashed border-border bg-bg-muted px-4 py-4 sm:px-6"
          aria-live="polite"
        >
          <LoadingSkeleton lines={1} className="mx-4 my-2" />
        </div>
      </li>
    );
  }

  return (
    <li ref={setNodeRef} style={style}>
      <div
        className={cn(
          'group px-4 py-4 transition-colors duration-fast sm:px-6',
          'hover:bg-bg-subtle',
          isSelected && 'bg-primary-subtle',
        )}
      >
        <div className="flex items-center justify-between">
          {/* 多选模式才显示 checkbox */}
          {isMultiSelectMode && (
            <div
              className="mr-2 flex-shrink-0"
              onClick={(e) => onToggleSelect(policy.id, e)}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => {}}
                className="size-4 cursor-pointer rounded border-border text-primary focus:ring-primary"
              />
            </div>
          )}

          {/* 拖拽手柄 — 默认隐藏，行 hover 显形 */}
          <div
            {...listeners}
            {...attributes}
            className="mr-3 flex-shrink-0 cursor-grab rounded p-1 opacity-0 transition-opacity hover:bg-bg-muted group-hover:opacity-100 active:cursor-grabbing"
          >
            <GripVertical className="size-4 text-fg-subtle" />
          </div>

          <div className="min-w-0 flex-1">
            <Link href={`/${locale}/policies/${policy.id}`} className="block">
              <p className="truncate text-sm font-medium text-primary hover:underline">
                {policy.name}
              </p>
              {policy.description && (
                <p className="mt-1 truncate text-sm text-fg-muted">
                  {policy.description}
                </p>
              )}
            </Link>
          </div>
          <div className="ml-4 flex items-center space-x-3">
            {policy.group && (
              <Badge variant="neutral">
                <Folder className="size-3" aria-hidden />
                {policy.group.name}
              </Badge>
            )}
            {policy.isFrozen && (
              <Badge variant="accent">
                <Snowflake className="size-3" aria-hidden />
                {t.freeze.badge}
              </Badge>
            )}
            {policy.piiFields && policy.piiFields.length > 0 && (
              <Badge variant="warning">
                {formatTemplate(t.piiFieldsTemplate, { count: policy.piiFields.length })}
              </Badge>
            )}
            {policy.isPublic && <Badge variant="success">{t.public}</Badge>}

            <span className="text-sm text-fg-muted">
              {formatTemplate(t.executionsTemplate, { count: policy._count.executions })}
            </span>

            {/* Row actions — text-only buttons so they don't overpower
                the row chrome. Frozen state renders as muted, non-clickable
                so users see the affordance is gated. */}
            <div className="flex items-center space-x-3">
              {policy.isFrozen ? (
                <span
                  className="cursor-not-allowed text-sm text-fg-subtle"
                  title={t.freeze.cannotExecute}
                >
                  {t.executeAction}
                </span>
              ) : (
                <Link
                  href={`/${locale}/policies/${policy.id}/execute`}
                  className="text-sm font-medium text-primary hover:text-primary-hover"
                >
                  {t.executeAction}
                </Link>
              )}
              {policy.isFrozen ? (
                <span
                  className="cursor-not-allowed text-sm text-fg-subtle"
                  title={t.freeze.cannotEdit}
                >
                  {t.edit}
                </span>
              ) : (
                <Link
                  href={`/${locale}/policies/${policy.id}/edit`}
                  className="text-sm text-fg-muted hover:text-fg"
                >
                  {t.edit}
                </Link>
              )}
              <button
                onClick={() => onDelete(policy)}
                className="text-sm text-danger hover:opacity-80"
              >
                {t.delete}
              </button>
            </div>
          </div>
        </div>
        <div className="ml-8 mt-2">
          <p className="text-xs text-fg-subtle">
            {formatTemplate(t.updatedTemplate, { date: formatDate(policy.updatedAt, locale) })}
          </p>
        </div>
      </div>
    </li>
  );
}

// 拖拽覆盖层显示的策略项（带叠放效果）
function DragOverlayPolicy({ policy, selectedCount }: { policy: Policy; selectedCount: number }) {
  return (
    <div className="relative">
      {/* 多选叠放效果：最多两层背景卡，制造一摞被搬运的感觉 */}
      {selectedCount > 1 && (
        <>
          {selectedCount > 2 && (
            <div className="absolute left-2 top-2 size-full rounded-md bg-bg-muted opacity-60 shadow-sm" />
          )}
          <div className="absolute left-1 top-1 size-full rounded-md bg-bg-subtle opacity-80 shadow-md" />
        </>
      )}
      {/* 顶层 — 当前正在拖的策略，描边采用主色 */}
      <div className="relative cursor-grabbing rounded-md border-2 border-primary bg-bg px-4 py-3 shadow-lg">
        <div className="flex items-center">
          <div className="flex-1">
            <p className="text-sm font-medium text-primary">{policy.name}</p>
            {policy.description && (
              <p className="mt-1 truncate text-sm text-fg-muted">{policy.description}</p>
            )}
          </div>
          {selectedCount > 1 && (
            <span className="ml-2 inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-fg">
              {selectedCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface PoliciesContentProps {
  initialPolicies: Policy[];
  initialGroups: PolicyGroup[];
  freezeInfo: FreezeInfo;
  translations: Translations;
  locale: string;
}

export function PoliciesContent({
  initialPolicies,
  initialGroups,
  freezeInfo: initialFreezeInfo,
  translations: t,
  locale,
}: PoliciesContentProps) {
  // 延迟挂载 DndContext，避免 @dnd-kit aria 属性导致的 hydration mismatch (#418)
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [policies, setPolicies] = useState<Policy[]>(initialPolicies);
  const [groups, setGroups] = useState<PolicyGroup[]>(initialGroups);
  const [freezeInfo, setFreezeInfo] = useState<FreezeInfo>(initialFreezeInfo);
  const [error, setError] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const tCommon = useTranslations('common');
  // Hook-based i18n for keys added in PR-E (replaces inline
  // `locale.startsWith('zh') ? '中文' : 'English'` ternaries).
  const tForm = useTranslations('policies.form');

  // 分组对话框状态
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [editingGroup, setEditingGroup] = useState<PolicyGroup | null>(null);
  const [createParentId, setCreateParentId] = useState<string | null>(null);

  // 拖拽状态
  const [activePolicy, setActivePolicy] = useState<Policy | null>(null);

  // 多选状态
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<Set<string>>(new Set());
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);

  // 删除确认对话框状态
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [policyToDelete, setPolicyToDelete] = useState<Policy | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // 配置拖拽传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 需要移动8px才开始拖拽，避免误触
      },
    })
  );

  // 计算策略总数和未分组策略数（基于本地状态，拖拽后立即更新）
  const totalPoliciesCount = policies.length;
  const ungroupedCount = useMemo(() => policies.filter((p) => !p.groupId).length, [policies]);

  // 切换策略选中状态
  const handleToggleSelect = useCallback((policyId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedPolicyIds((prev) => {
      const next = new Set(prev);
      if (next.has(policyId)) {
        next.delete(policyId);
      } else {
        next.add(policyId);
      }
      return next;
    });
  }, []);

  // 清除选中状态
  const clearSelection = useCallback(() => {
    setSelectedPolicyIds(new Set());
  }, []);

  // 筛选后的策略列表
  const filteredPolicies = useMemo(() => {
    if (selectedGroupId === null) {
      return policies;
    }
    if (selectedGroupId === 'ungrouped') {
      return policies.filter((p) => !p.groupId);
    }
    // 递归获取子分组的所有ID
    const getDescendantIds = (group: PolicyGroup): string[] => {
      const ids = [group.id];
      if (group.children) {
        for (const child of group.children) {
          ids.push(...getDescendantIds(child));
        }
      }
      return ids;
    };

    const findGroup = (groups: PolicyGroup[], id: string): PolicyGroup | null => {
      for (const group of groups) {
        if (group.id === id) return group;
        if (group.children) {
          const found = findGroup(group.children, id);
          if (found) return found;
        }
      }
      return null;
    };

    const targetGroup = findGroup(groups, selectedGroupId);
    if (!targetGroup) return policies.filter((p) => p.groupId === selectedGroupId);

    const groupIds = new Set(getDescendantIds(targetGroup));
    return policies.filter((p) => p.groupId && groupIds.has(p.groupId));
  }, [policies, groups, selectedGroupId]);

  // Layer name/description text search on top of the group-tree filter.
  // Both filters compose: pick a group AND match a query.
  const visiblePolicies = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return filteredPolicies;
    return filteredPolicies.filter((p) => {
      const hay = [p.name, p.description ?? ''].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [filteredPolicies, query]);

  // 重新获取策略列表和冻结状态
  const refreshPolicies = useCallback(async () => {
    try {
      const res = await fetch('/api/policies');
      if (!res.ok) return;
      const data = await res.json();
      setPolicies(data.policies || []);
      if (data.freezeInfo) {
        setFreezeInfo(data.freezeInfo);
      }
    } catch (err) {
      console.error('Failed to refresh policies:', err);
    }
  }, []);

  // 获取分组列表
  const refreshGroups = useCallback(async () => {
    try {
      const res = await fetch('/api/policy-groups');
      if (!res.ok) return;
      const data = await res.json();
      setGroups(data.groups || []);
    } catch (err) {
      console.error('Failed to refresh groups:', err);
    }
  }, []);

  // 拖拽开始
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const policy = policies.find((p) => p.id === active.id);
    if (policy) {
      setActivePolicy(policy);
      // 如果拖拽的策略未选中，清除其他选择，只选中当前
      if (!selectedPolicyIds.has(policy.id)) {
        setSelectedPolicyIds(new Set([policy.id]));
      }
    }
  }, [policies, selectedPolicyIds]);

  // 拖拽结束 - 更新策略的分组（支持批量移动）
  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    setActivePolicy(null);

    if (!over) return;

    const draggedPolicyId = active.id as string;
    const targetGroupId = over.id as string;

    // 如果目标是 'ungrouped'，设置 groupId 为 null
    const newGroupId = targetGroupId === 'ungrouped' ? null : targetGroupId;

    // 获取要移动的所有策略 ID（如果被拖拽的策略在选中列表中，移动所有选中的）
    const policyIdsToMove = selectedPolicyIds.has(draggedPolicyId)
      ? Array.from(selectedPolicyIds)
      : [draggedPolicyId];

    // 获取要移动的策略
    const policiesToMove = policies.filter((p) => policyIdsToMove.includes(p.id));

    // 过滤掉分组未变化的策略
    const policiesToUpdate = policiesToMove.filter((p) => p.groupId !== newGroupId);
    if (policiesToUpdate.length === 0) return;

    // 计算每个原分组减少的策略数
    const groupCountChanges = new Map<string | null, number>();
    for (const p of policiesToUpdate) {
      const oldGroupId = p.groupId;
      groupCountChanges.set(oldGroupId, (groupCountChanges.get(oldGroupId) || 0) - 1);
    }
    // 目标分组增加的策略数
    groupCountChanges.set(newGroupId, (groupCountChanges.get(newGroupId) || 0) + policiesToUpdate.length);

    // 从 groups 中找到目标分组信息
    const findGroup = (groups: PolicyGroup[], id: string): PolicyGroup | null => {
      for (const g of groups) {
        if (g.id === id) return g;
        if (g.children) {
          const found = findGroup(g.children, id);
          if (found) return found;
        }
      }
      return null;
    };
    const targetGroup = newGroupId ? findGroup(groups, newGroupId) : null;
    const newGroupInfo = targetGroup
      ? { id: targetGroup.id, name: targetGroup.name, icon: targetGroup.icon, parentId: targetGroup.parentId }
      : null;

    // 乐观更新策略的分组信息
    const policyIdsToUpdateSet = new Set(policiesToUpdate.map((p) => p.id));
    setPolicies((prev) =>
      prev.map((p) =>
        policyIdsToUpdateSet.has(p.id)
          ? { ...p, groupId: newGroupId, group: newGroupInfo }
          : p
      )
    );

    // 乐观更新分组的策略计数
    setGroups((prev) => {
      const updateGroupCount = (groups: PolicyGroup[]): PolicyGroup[] => {
        return groups.map((g) => {
          let updatedGroup = { ...g };
          const change = groupCountChanges.get(g.id);
          if (change) {
            updatedGroup = {
              ...updatedGroup,
              _count: { policies: Math.max(0, g._count.policies + change) },
            };
          }
          // 递归处理子分组
          if (g.children && g.children.length > 0) {
            updatedGroup = {
              ...updatedGroup,
              children: updateGroupCount(g.children),
            };
          }
          return updatedGroup;
        });
      };
      return updateGroupCount(prev);
    });

    // 调用 API 批量更新
    try {
      const updatePromises = policiesToUpdate.map((p) =>
        fetch(`/api/policies/${p.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId: newGroupId }),
        })
      );

      const results = await Promise.all(updatePromises);
      const hasError = results.some((res) => !res.ok);

      if (hasError) {
        // 如果有失败，回滚更改
        await refreshPolicies();
        setError(tForm('failedToMove'));
      } else {
        // 刷新分组以更新策略计数，并清除选择
        await refreshGroups();
        clearSelection();
      }
    } catch (err) {
      console.error('Failed to update policy group:', err);
      await refreshPolicies();
      setError(tForm('failedToMove'));
    }
  }, [policies, groups, selectedPolicyIds, tForm, refreshPolicies, refreshGroups, clearSelection]);

  // 打开删除确认对话框
  const handleDeleteClick = useCallback((policy: Policy) => {
    setPolicyToDelete(policy);
    setDeleteDialogOpen(true);
  }, []);

  // 确认删除策略
  const handleConfirmDelete = useCallback(async () => {
    if (!policyToDelete) return;

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/policies/${policyToDelete.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete policy');
      // 删除后重新获取列表以更新冻结状态
      await refreshPolicies();
      setDeleteDialogOpen(false);
      setPolicyToDelete(null);
    } catch (err) {
      setError(t.failedToDelete);
      console.error(err);
    } finally {
      setIsDeleting(false);
    }
  }, [policyToDelete, refreshPolicies, t.failedToDelete]);

  // 取消删除
  const handleCancelDelete = useCallback(() => {
    if (isDeleting) return;
    setDeleteDialogOpen(false);
    setPolicyToDelete(null);
  }, [isDeleting]);

  // 分组操作
  const handleCreateGroup = useCallback((parentId: string | null) => {
    setDialogMode('create');
    setEditingGroup(null);
    setCreateParentId(parentId);
    setDialogOpen(true);
  }, []);

  const handleEditGroup = useCallback((group: PolicyGroup) => {
    setDialogMode('edit');
    setEditingGroup(group);
    setDialogOpen(true);
  }, []);

  const handleDeleteGroup = useCallback((group: PolicyGroup) => {
    setDialogMode('edit');
    setEditingGroup(group);
    setDialogOpen(true);
  }, []);

  const handleSaveGroup = useCallback(
    async (data: { name: string; description: string; parentId: string | null }) => {
      if (dialogMode === 'create') {
        const res = await fetch('/api/policy-groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: data.name,
            description: data.description || null,
            parentId: createParentId,
          }),
        });
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || 'Failed to create group');
        }
      } else if (editingGroup) {
        const res = await fetch(`/api/policy-groups/${editingGroup.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: data.name,
            description: data.description || null,
          }),
        });
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || 'Failed to update group');
        }
      }
      await refreshGroups();
    },
    [dialogMode, editingGroup, createParentId, refreshGroups]
  );

  const handleDeleteGroupConfirm = useCallback(async () => {
    if (!editingGroup) return;
    const res = await fetch(`/api/policy-groups/${editingGroup.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ movePoliciesToParent: true, moveChildrenToParent: true }),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to delete group');
    }
    // 如果删除的是当前选中的分组，重置选中状态
    if (selectedGroupId === editingGroup.id) {
      setSelectedGroupId(null);
    }
    await Promise.all([refreshGroups(), refreshPolicies()]);
  }, [editingGroup, selectedGroupId, refreshGroups, refreshPolicies]);

  if (!mounted) {
    // SSR / 首次渲染：不渲染 DndContext，避免 aria live region hydration mismatch
    return <div className="flex h-[calc(100vh-8rem)]" />;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={smallestDroppableCollision}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-[calc(100vh-8rem)]">
        {/* 左侧分组树 */}
        <PolicyGroupTree
          groups={groups}
          selectedGroupId={selectedGroupId}
          onSelectGroup={setSelectedGroupId}
          onCreateGroup={handleCreateGroup}
          onEditGroup={handleEditGroup}
          onDeleteGroup={handleDeleteGroup}
          isDragging={!!activePolicy}
          totalPoliciesCount={totalPoliciesCount}
          ungroupedCount={ungroupedCount}
          translations={{
            allPolicies: t.groups.allPolicies,
            ungrouped: t.groups.ungrouped,
            newGroup: t.groups.newGroup,
            newSubgroup: t.groups.newSubgroup,
            edit: t.groups.edit,
            delete: t.groups.delete,
            policiesCount: t.groups.policiesCount,
          }}
        />

      {/* 右侧策略列表 */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="sm:flex sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">
              {t.title}
            </h1>
            <p className="mt-1 text-sm text-fg-muted">{t.subtitle}</p>
          </div>
          <div className="mt-4 flex space-x-3 sm:mt-0">
            {/* 多选 / 单选切换按钮 */}
            <button
              type="button"
              onClick={() => {
                setIsMultiSelectMode((prev) => !prev);
                if (isMultiSelectMode) {
                  clearSelection();
                }
              }}
              className={buttonVariants({ variant: 'secondary', size: 'md' })}
            >
              {isMultiSelectMode ? (
                <>
                  <Circle className="size-4" aria-hidden />
                  {tForm('selectionSingle')}
                </>
              ) : (
                <>
                  <ListChecks className="size-4" aria-hidden />
                  {tForm('selectionMulti')}
                </>
              )}
            </button>
            <Link
              href={`/${locale}/policies/trash`}
              className={buttonVariants({ variant: 'secondary', size: 'md' })}
            >
              <Trash2 className="size-4" aria-hidden />
              {t.trash}
            </Link>
            <Link
              href={`/${locale}/policies/new`}
              className={buttonVariants({ variant: 'primary', size: 'md' })}
            >
              <Plus className="size-4" aria-hidden />
              {t.newPolicy}
            </Link>
          </div>
        </div>

        {error && (
          <ErrorState error={error} onRetry={() => setError('')} className="mt-4" />
        )}

        {/* Freeze warning — Alert.warning with embedded upgrade link */}
        {freezeInfo.frozenCount > 0 && (
          <Alert variant="warning" className="mt-4">
            <AlertTitle>{t.freeze.title}</AlertTitle>
            <AlertDescription>
              {formatTemplate(t.freeze.messageTemplate, {
                frozen: freezeInfo.frozenCount,
                limit: freezeInfo.limit,
                total: freezeInfo.total,
              })}
              {CLIENT_CAPABILITIES.billing && (
                <div className="mt-2">
                  <Link
                    href={`/${locale}/billing`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {t.freeze.upgradeLink}
                  </Link>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        {policies.length > 0 && (
          <div className="mt-4">
            <ListSearchInput
              value={query}
              onChange={setQuery}
              placeholder={tCommon('searchPlaceholder')}
            />
          </div>
        )}

        {filteredPolicies.length === 0 ? (
          <div className="mt-8 text-center">
            <FileText className="mx-auto size-12 text-fg-subtle" aria-hidden />
            <h3 className="mt-2 text-sm font-semibold text-fg">{t.noPolicies}</h3>
            <p className="mt-1 text-sm text-fg-muted">{t.getStarted}</p>
            <div className="mt-6">
              <Link
                href={`/${locale}/policies/new`}
                className={buttonVariants({ variant: 'primary', size: 'md' })}
              >
                <Plus className="size-4" aria-hidden />
                {t.newPolicy}
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-8 overflow-hidden rounded-md border border-border bg-bg shadow-sm">
            <ul className="divide-y divide-border">
              {visiblePolicies.map((policy) => (
                <DraggablePolicyItem
                  key={policy.id}
                  policy={policy}
                  locale={locale}
                  translations={t}
                  onDelete={handleDeleteClick}
                  isSelected={selectedPolicyIds.has(policy.id)}
                  onToggleSelect={handleToggleSelect}
                  selectedCount={selectedPolicyIds.size}
                  isMultiSelectMode={isMultiSelectMode}
                  isBeingDragged={!!activePolicy}
                />
              ))}
            </ul>
          </div>
        )}

        {/* Policies shared with caller's teams. Self-gates: returns
            nothing when sharing is off or the caller has no inbound
            shares. */}
        <SharedWithMeSection locale={locale} />
      </div>

      {/* 拖拽覆盖层 */}
      <DragOverlay>
        {activePolicy ? (
          <DragOverlayPolicy
            policy={activePolicy}
            selectedCount={selectedPolicyIds.has(activePolicy.id) ? selectedPolicyIds.size : 1}
          />
        ) : null}
      </DragOverlay>

      {/* 分组对话框 */}
      <PolicyGroupDialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSaveGroup}
        onDelete={dialogMode === 'edit' ? handleDeleteGroupConfirm : undefined}
        group={editingGroup}
        parentId={createParentId}
        mode={dialogMode}
        translations={{
          createTitle: t.groups.createTitle,
          editTitle: t.groups.editTitle,
          nameLabel: t.groups.nameLabel,
          namePlaceholder: t.groups.namePlaceholder,
          descriptionLabel: t.groups.descriptionLabel,
          descriptionPlaceholder: t.groups.descriptionPlaceholder,
          save: t.groups.save,
          cancel: t.groups.cancel,
          delete: t.groups.delete,
          deleteConfirm: t.groups.deleteConfirm,
          deleteWarning: t.groups.deleteWarning,
          saving: t.groups.saving,
          deleting: t.groups.deleting,
        }}
      />

      {/* 删除策略确认对话框 */}
      <ConfirmDialog
        isOpen={deleteDialogOpen}
        onCancel={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        title={tForm('deleteDialogTitle')}
        description={
          policyToDelete
            ? tForm('deleteDialogBody', { name: policyToDelete.name })
            : ''
        }
        confirmLabel={tForm('deleteDialogConfirm')}
        cancelLabel={tForm('deleteDialogCancel')}
        variant="danger"
        isLoading={isDeleting}
      />
      </div>
    </DndContext>
  );
}
