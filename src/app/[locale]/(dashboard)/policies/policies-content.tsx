'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { formatDate } from '@/lib/format';
import { PolicyGroupTree, PolicyGroup } from '@/components/policy/policy-group-tree';
import { PolicyGroupDialog } from '@/components/policy/policy-group-dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LoadingSkeleton } from '@/components/feedback/loading-skeleton';
import { ErrorState } from '@/components/feedback/error-state';
import { Folder, GripVertical } from 'lucide-react';
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

  // 如果被选中且正在拖拽，显示带无障碍标注的骨架占位符
  if (showPlaceholder) {
    return (
      <li ref={setNodeRef} style={style}>
        <div
          className="px-4 py-4 sm:px-6 bg-gray-100 border-2 border-dashed border-gray-300 rounded-md"
          aria-live="polite"
        >
          <LoadingSkeleton lines={1} className="mx-4 my-2" />
        </div>
      </li>
    );
  }

  return (
    <li ref={setNodeRef} style={style}>
      <div className={`px-4 py-4 sm:px-6 hover:bg-gray-50 group ${isSelected ? 'bg-indigo-50' : ''}`}>
        <div className="flex items-center justify-between">
          {/* 复选框 - 仅在多选模式下显示 */}
          {isMultiSelectMode && (
            <div
              className="flex-shrink-0 mr-2"
              onClick={(e) => onToggleSelect(policy.id, e)}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => {}}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 cursor-pointer"
              />
            </div>
          )}

          {/* 拖拽手柄 */}
          <div
            {...listeners}
            {...attributes}
            className="flex-shrink-0 mr-3 cursor-grab active:cursor-grabbing p-1 rounded hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <GripVertical className="w-4 h-4 text-gray-400" />
          </div>

          <div className="flex-1 min-w-0">
            <Link href={`/${locale}/policies/${policy.id}`} className="block">
              <p className="text-sm font-medium text-indigo-600 truncate hover:underline">
                {policy.name}
              </p>
              {policy.description && (
                <p className="mt-1 text-sm text-gray-500 truncate">
                  {policy.description}
                </p>
              )}
            </Link>
          </div>
          <div className="ml-4 flex items-center space-x-4">
            {/* Group Badge */}
            {policy.group && (
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                <Folder className="w-3 h-3 mr-1" />
                {policy.group.name}
              </span>
            )}

            {/* Frozen Badge */}
            {policy.isFrozen && (
              <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                <svg className="mr-1 h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 1a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 1zM5.05 3.05a.75.75 0 011.06 0l1.062 1.06a.75.75 0 01-1.06 1.061l-1.061-1.06a.75.75 0 010-1.06zm9.9 0a.75.75 0 010 1.06l-1.06 1.061a.75.75 0 11-1.061-1.06l1.06-1.06a.75.75 0 011.06 0zM10 14a4 4 0 100-8 4 4 0 000 8zm-8.25-3.25a.75.75 0 000 1.5h1.5a.75.75 0 000-1.5h-1.5zm14.5 0a.75.75 0 000 1.5h1.5a.75.75 0 000-1.5h-1.5zM5.05 16.95a.75.75 0 001.06 0l1.06-1.06a.75.75 0 00-1.06-1.061l-1.06 1.06a.75.75 0 000 1.061zm9.9 0a.75.75 0 010-1.06l1.06-1.061a.75.75 0 111.061 1.06l-1.06 1.06a.75.75 0 01-1.061 0z" clipRule="evenodd" />
                </svg>
                {t.freeze.badge}
              </span>
            )}

            {/* PII Badge */}
            {policy.piiFields && policy.piiFields.length > 0 && (
              <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800">
                {formatTemplate(t.piiFieldsTemplate, { count: policy.piiFields.length })}
              </span>
            )}

            {/* Public Badge */}
            {policy.isPublic && (
              <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                {t.public}
              </span>
            )}

            {/* Execution count */}
            <span className="text-sm text-gray-500">
              {formatTemplate(t.executionsTemplate, { count: policy._count.executions })}
            </span>

            {/* Actions */}
            <div className="flex items-center space-x-2">
              {policy.isFrozen ? (
                <span className="text-gray-400 text-sm cursor-not-allowed" title={t.freeze.cannotExecute}>
                  {t.executeAction}
                </span>
              ) : (
                <Link
                  href={`/${locale}/policies/${policy.id}/execute`}
                  className="text-indigo-600 hover:text-indigo-900 text-sm"
                >
                  {t.executeAction}
                </Link>
              )}
              {policy.isFrozen ? (
                <span className="text-gray-400 text-sm cursor-not-allowed" title={t.freeze.cannotEdit}>
                  {t.edit}
                </span>
              ) : (
                <Link
                  href={`/${locale}/policies/${policy.id}/edit`}
                  className="text-gray-600 hover:text-gray-900 text-sm"
                >
                  {t.edit}
                </Link>
              )}
              <button
                onClick={() => onDelete(policy)}
                className="text-red-600 hover:text-red-900 text-sm"
              >
                {t.delete}
              </button>
            </div>
          </div>
        </div>
        <div className="mt-2 ml-8">
          <p className="text-xs text-gray-400">
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
      {/* 叠放效果 - 显示最多2层背景卡片 */}
      {selectedCount > 1 && (
        <>
          {/* 第三层（最底层） */}
          {selectedCount > 2 && (
            <div className="absolute top-2 left-2 w-full h-full bg-gray-200 rounded-md shadow-sm opacity-60" />
          )}
          {/* 第二层 */}
          <div className="absolute top-1 left-1 w-full h-full bg-gray-100 rounded-md shadow-md opacity-80" />
        </>
      )}
      {/* 顶层卡片 */}
      <div className="relative bg-white shadow-lg rounded-md px-4 py-3 border-2 border-indigo-500 cursor-grabbing">
        <div className="flex items-center">
          <div className="flex-1">
            <p className="text-sm font-medium text-indigo-600">{policy.name}</p>
            {policy.description && (
              <p className="mt-1 text-sm text-gray-500 truncate">{policy.description}</p>
            )}
          </div>
          {selectedCount > 1 && (
            <span className="ml-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-medium">
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
        setError(locale.startsWith('zh') ? '移动策略失败' : 'Failed to move policy');
      } else {
        // 刷新分组以更新策略计数，并清除选择
        await refreshGroups();
        clearSelection();
      }
    } catch (err) {
      console.error('Failed to update policy group:', err);
      await refreshPolicies();
      setError(locale.startsWith('zh') ? '移动策略失败' : 'Failed to move policy');
    }
  }, [policies, groups, selectedPolicyIds, locale, refreshPolicies, refreshGroups, clearSelection]);

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
            <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
            <p className="mt-1 text-sm text-gray-500">{t.subtitle}</p>
          </div>
          <div className="mt-4 sm:mt-0 flex space-x-3">
            {/* 多选/单选切换按钮 */}
            <button
              onClick={() => {
                setIsMultiSelectMode((prev) => !prev);
                if (isMultiSelectMode) {
                  clearSelection();
                }
              }}
              className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
            >
              {isMultiSelectMode ? (
                <>
                  <svg className="-ml-0.5 mr-1.5 h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {locale.startsWith('zh') ? '单选' : 'Single'}
                </>
              ) : (
                <>
                  <svg className="-ml-0.5 mr-1.5 h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {locale.startsWith('zh') ? '多选' : 'Multi'}
                </>
              )}
            </button>
            <Link
              href={`/${locale}/policies/trash`}
              className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
            >
              <svg className="-ml-0.5 mr-1.5 h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              {t.trash}
            </Link>
            <Link
              href={`/${locale}/policies/new`}
              className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
            >
              <svg className="-ml-0.5 mr-1.5 h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
              </svg>
              {t.newPolicy}
            </Link>
          </div>
        </div>

        {error && (
          <ErrorState error={error} onRetry={() => setError('')} className="mt-4" />
        )}

        {/* Freeze Warning Banner */}
        {freezeInfo.frozenCount > 0 && (
          <div className="mt-4 rounded-md bg-amber-50 border border-amber-200 p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-amber-800">{t.freeze.title}</h3>
                <p className="mt-1 text-sm text-amber-700">
                  {formatTemplate(t.freeze.messageTemplate, { frozen: freezeInfo.frozenCount, limit: freezeInfo.limit, total: freezeInfo.total })}
                </p>
                <div className="mt-2">
                  <Link
                    href={`/${locale}/billing`}
                    className="text-sm font-medium text-amber-800 underline hover:text-amber-900"
                  >
                    {t.freeze.upgradeLink}
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {filteredPolicies.length === 0 ? (
          <div className="mt-8 text-center">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <h3 className="mt-2 text-sm font-semibold text-gray-900">{t.noPolicies}</h3>
            <p className="mt-1 text-sm text-gray-500">{t.getStarted}</p>
            <div className="mt-6">
              <Link
                href={`/${locale}/policies/new`}
                className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                <svg className="-ml-0.5 mr-1.5 h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                </svg>
                {t.newPolicy}
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-8 overflow-hidden bg-white shadow sm:rounded-md">
            <ul className="divide-y divide-gray-200">
              {filteredPolicies.map((policy) => (
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
        title={locale.startsWith('zh') ? '删除策略' : 'Delete Policy'}
        description={
          policyToDelete
            ? locale.startsWith('zh')
              ? `确定要删除策略 "${policyToDelete.name}" 吗？此操作可以在回收站中撤销。`
              : `Are you sure you want to delete "${policyToDelete.name}"? This can be undone from the trash.`
            : ''
        }
        confirmLabel={locale.startsWith('zh') ? '删除' : 'Delete'}
        cancelLabel={locale.startsWith('zh') ? '取消' : 'Cancel'}
        variant="danger"
        isLoading={isDeleting}
      />
      </div>
    </DndContext>
  );
}
