'use client';

import { useState, useCallback, useMemo } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, Plus, MoreVertical, Pencil, Trash2, FolderPlus } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';

export interface PolicyGroup {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  parentId: string | null;
  isSystem: boolean;
  sortOrder: number;
  children: PolicyGroup[];
  _count: {
    policies: number;
  };
}

// 最大分组层级数
const MAX_GROUP_DEPTH = 5;

// 递归计算分组总策略数（包含所有子分组）
function getTotalPoliciesCount(group: PolicyGroup): number {
  let total = group._count.policies;
  if (group.children) {
    for (const child of group.children) {
      total += getTotalPoliciesCount(child);
    }
  }
  return total;
}

interface PolicyGroupTreeProps {
  groups: PolicyGroup[];
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string | null) => void;
  onCreateGroup?: (parentId: string | null) => void;
  onEditGroup?: (group: PolicyGroup) => void;
  onDeleteGroup?: (group: PolicyGroup) => void;
  isDragging?: boolean;
  totalPoliciesCount: number;
  ungroupedCount: number;
  translations: {
    allPolicies: string;
    ungrouped: string;
    newGroup: string;
    newSubgroup: string;
    edit: string;
    delete: string;
    policiesCount: string;
  };
}

// 可放置的分组项包装器
function DroppableGroupItem({
  id,
  children,
  isDragging,
}: {
  id: string;
  children: (isOver: boolean) => React.ReactNode;
  isDragging?: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id,
    data: { type: 'group', groupId: id },
  });

  return (
    <div
      ref={setNodeRef}
      className={`transition-colors ${
        isDragging && isOver ? 'ring-2 ring-indigo-500 ring-inset rounded-md' : ''
      }`}
    >
      {children(isOver)}
    </div>
  );
}

export function PolicyGroupTree({
  groups,
  selectedGroupId,
  onSelectGroup,
  onCreateGroup,
  onEditGroup,
  onDeleteGroup,
  isDragging = false,
  totalPoliciesCount,
  ungroupedCount,
  translations: t,
}: PolicyGroupTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const toggleExpand = useCallback((groupId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const handleMenuToggle = useCallback((groupId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpenId((prev) => (prev === groupId ? null : groupId));
  }, []);

  const renderGroupItem = (group: PolicyGroup, depth: number = 0) => {
    const isExpanded = expandedIds.has(group.id);
    const isSelected = selectedGroupId === group.id;
    const hasChildren = group.children && group.children.length > 0;
    const isMenuOpen = menuOpenId === group.id;

    return (
      <DroppableGroupItem key={group.id} id={group.id} isDragging={isDragging}>
        {(isOver) => (
          <>
            <div
              className={`group flex items-center px-2 py-1.5 text-sm rounded-md cursor-pointer transition-colors ${
                isDragging && isOver
                  ? 'bg-indigo-100 text-indigo-800'
                  : isSelected
                  ? 'bg-indigo-100 text-indigo-800'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
              onClick={() => onSelectGroup(group.id)}
            >
          {/* Expand/Collapse Icon */}
          <span
            className={`flex-shrink-0 w-4 h-4 mr-1 ${hasChildren ? 'cursor-pointer' : ''}`}
            onClick={(e) => hasChildren && toggleExpand(group.id, e)}
          >
            {hasChildren ? (
              isExpanded ? (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-400" />
              )
            ) : null}
          </span>

          {/* Folder Icon */}
          {isExpanded && hasChildren ? (
            <FolderOpen className="w-4 h-4 mr-2 text-indigo-500" />
          ) : (
            <Folder className="w-4 h-4 mr-2 text-gray-400" />
          )}

          {/* Group Name */}
          <span className="flex-1 truncate">{group.name}</span>

          {/* Policy Count - 显示包含子分组的总数 */}
          <span className="text-xs text-gray-400 mr-2">
            {getTotalPoliciesCount(group)}
          </span>

          {/* Context Menu */}
          {!group.isSystem && (onEditGroup || onDeleteGroup || onCreateGroup) && (
            <div className="relative">
              <button
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-200"
                onClick={(e) => handleMenuToggle(group.id, e)}
              >
                <MoreVertical className="w-4 h-4 text-gray-500" />
              </button>

              {isMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-md shadow-lg border border-gray-200 z-10">
                  {/* 最多支持5级分组，第5级不再显示"新建子分组" */}
                  {onCreateGroup && depth < MAX_GROUP_DEPTH - 1 && (
                    <button
                      className="w-full flex items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(null);
                        onCreateGroup(group.id);
                      }}
                    >
                      <FolderPlus className="w-4 h-4 mr-2" />
                      {t.newSubgroup}
                    </button>
                  )}
                  {onEditGroup && (
                    <button
                      className="w-full flex items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(null);
                        onEditGroup(group);
                      }}
                    >
                      <Pencil className="w-4 h-4 mr-2" />
                      {t.edit}
                    </button>
                  )}
                  {onDeleteGroup && (
                    <button
                      className="w-full flex items-center px-3 py-2 text-sm text-red-600 hover:bg-gray-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(null);
                        onDeleteGroup(group);
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      {t.delete}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

            {/* Children - 拖拽时自动展开所有子分组以便放置 */}
            {hasChildren && (isExpanded || isDragging) && (
              <div>
                {group.children.map((child) => renderGroupItem(child, depth + 1))}
              </div>
            )}
          </>
        )}
      </DroppableGroupItem>
    );
  };

  return (
    <div className="w-56 flex-shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto">
      <div className="p-3">
        {/* Header with Create Button */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Groups
          </span>
          {onCreateGroup && (
            <button
              className="p-1 rounded hover:bg-gray-200"
              onClick={() => onCreateGroup(null)}
              title={t.newGroup}
            >
              <Plus className="w-4 h-4 text-gray-500" />
            </button>
          )}
        </div>

        {/* All Policies */}
        <div
          className={`flex items-center px-2 py-1.5 text-sm rounded-md cursor-pointer transition-colors mb-1 ${
            selectedGroupId === null
              ? 'bg-indigo-100 text-indigo-800'
              : 'text-gray-700 hover:bg-gray-100'
          }`}
          onClick={() => onSelectGroup(null)}
        >
          <Folder className="w-4 h-4 mr-2 text-gray-400" />
          <span className="flex-1">{t.allPolicies}</span>
          <span className="text-xs text-gray-400">{totalPoliciesCount}</span>
        </div>

        {/* Ungrouped */}
        <DroppableGroupItem id="ungrouped" isDragging={isDragging}>
          {(isOver) => (
            <div
              className={`flex items-center px-2 py-1.5 text-sm rounded-md cursor-pointer transition-colors mb-2 ${
                isDragging && isOver
                  ? 'bg-indigo-100 text-indigo-800'
                  : selectedGroupId === 'ungrouped'
                  ? 'bg-indigo-100 text-indigo-800'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => onSelectGroup('ungrouped')}
            >
              <Folder className="w-4 h-4 mr-2 text-gray-400" />
              <span className="flex-1">{t.ungrouped}</span>
              <span className="text-xs text-gray-400">{ungroupedCount}</span>
            </div>
          )}
        </DroppableGroupItem>

        {/* Divider */}
        <div className="border-t border-gray-200 my-2" />

        {/* Group Tree */}
        <div className="space-y-0.5">
          {groups.map((group) => renderGroupItem(group, 0))}
        </div>
      </div>
    </div>
  );
}
