'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Folder, FolderOpen, Check, X } from 'lucide-react';

interface PolicyGroup {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  parentId: string | null;
  isSystem: boolean;
  sortOrder: number;
  children?: PolicyGroup[];
  _count?: {
    policies: number;
  };
}

interface PolicyGroupSelectProps {
  value: string | null;
  onChange: (groupId: string | null) => void;
  groups?: PolicyGroup[];
  placeholder?: string;
  label?: string;
  className?: string;
  disabled?: boolean;
}

export function PolicyGroupSelect({
  value,
  onChange,
  groups: externalGroups,
  placeholder = 'Select a group...',
  label,
  className = '',
  disabled = false,
}: PolicyGroupSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [groups, setGroups] = useState<PolicyGroup[]>(externalGroups || []);
  const [flatGroups, setFlatGroups] = useState<PolicyGroup[]>([]);
  const [isLoading, setIsLoading] = useState(!externalGroups);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch groups if not provided externally
  useEffect(() => {
    if (externalGroups) {
      setGroups(externalGroups);
      setFlatGroups(flattenGroups(externalGroups));
      setIsLoading(false);
      return;
    }

    const fetchGroups = async () => {
      try {
        const res = await fetch('/api/policy-groups');
        if (!res.ok) throw new Error('Failed to fetch groups');
        const data = await res.json();
        setGroups(data.groups || []);
        setFlatGroups(data.flatGroups || flattenGroups(data.groups || []));
      } catch (error) {
        console.error('Error fetching groups:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchGroups();
  }, [externalGroups]);

  // Flatten groups for easy lookup
  const flattenGroups = (groups: PolicyGroup[]): PolicyGroup[] => {
    const result: PolicyGroup[] = [];
    const flatten = (items: PolicyGroup[]) => {
      for (const item of items) {
        result.push(item);
        if (item.children && item.children.length > 0) {
          flatten(item.children);
        }
      }
    };
    flatten(groups);
    return result;
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Find selected group
  const selectedGroup = value ? flatGroups.find((g) => g.id === value) : null;

  // Render group item with indentation for hierarchy
  const renderGroupItem = (group: PolicyGroup, depth: number = 0) => {
    const isSelected = value === group.id;

    return (
      <div key={group.id}>
        <button
          type="button"
          className={`w-full flex items-center px-3 py-2 text-sm transition-colors ${
            isSelected
              ? 'bg-indigo-50 text-indigo-700'
              : 'text-gray-700 hover:bg-gray-50'
          }`}
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
          onClick={() => {
            onChange(group.id);
            setIsOpen(false);
          }}
        >
          <Folder className="w-4 h-4 mr-2 text-gray-400 flex-shrink-0" />
          <span className="flex-1 text-left truncate">{group.name}</span>
          {group._count && (
            <span className="text-xs text-gray-400 ml-2">{group._count.policies}</span>
          )}
          {isSelected && <Check className="w-4 h-4 ml-2 text-indigo-600 flex-shrink-0" />}
        </button>
        {group.children && group.children.length > 0 && (
          <div>
            {group.children.map((child) => renderGroupItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {label && (
        <label className="block text-sm font-semibold text-gray-900 mb-2">
          {label}
        </label>
      )}

      {/* Select Button */}
      <button
        type="button"
        disabled={disabled || isLoading}
        onClick={() => setIsOpen(!isOpen)}
        className={`
          w-full flex items-center justify-between rounded-lg border bg-white px-4 py-3 text-left shadow-sm transition-all duration-200
          ${disabled
            ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
            : isOpen
              ? 'border-indigo-500 ring-2 ring-indigo-500/20'
              : 'border-gray-300 hover:border-gray-400'
          }
        `}
      >
        <div className="flex items-center flex-1 min-w-0">
          {isLoading ? (
            <span className="text-gray-400 text-sm">Loading...</span>
          ) : selectedGroup ? (
            <>
              <Folder className="w-4 h-4 mr-2 text-indigo-500 flex-shrink-0" />
              <span className="text-gray-900 text-sm truncate">{selectedGroup.name}</span>
            </>
          ) : (
            <span className="text-gray-400 text-sm">{placeholder}</span>
          )}
        </div>

        <div className="flex items-center ml-2 flex-shrink-0">
          {/* Clear button */}
          {selectedGroup && !disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              className="p-1 rounded hover:bg-gray-100 mr-1"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          )}
          <ChevronDown
            className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Dropdown */}
      {isOpen && !disabled && (
        <div className="absolute z-20 mt-2 w-full bg-white rounded-lg shadow-lg border border-gray-200 max-h-64 overflow-y-auto">
          {/* Ungrouped option */}
          <button
            type="button"
            className={`w-full flex items-center px-3 py-2 text-sm transition-colors ${
              value === null
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-gray-700 hover:bg-gray-50'
            }`}
            onClick={() => {
              onChange(null);
              setIsOpen(false);
            }}
          >
            <Folder className="w-4 h-4 mr-2 text-gray-400" />
            <span className="flex-1 text-left">No group (Ungrouped)</span>
            {value === null && <Check className="w-4 h-4 ml-2 text-indigo-600" />}
          </button>

          {/* Divider */}
          {groups.length > 0 && <div className="border-t border-gray-100 my-1" />}

          {/* Groups */}
          {groups.map((group) => renderGroupItem(group, 0))}

          {/* Empty state */}
          {groups.length === 0 && !isLoading && (
            <div className="px-3 py-4 text-center text-sm text-gray-500">
              No groups available
            </div>
          )}
        </div>
      )}
    </div>
  );
}
