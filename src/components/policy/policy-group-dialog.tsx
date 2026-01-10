'use client';

import { useState, useEffect } from 'react';
import { X, Folder, AlertTriangle } from 'lucide-react';
import type { PolicyGroup } from './policy-group-tree';

interface PolicyGroupDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { name: string; description: string; parentId: string | null }) => Promise<void>;
  onDelete?: () => Promise<void>;
  group?: PolicyGroup | null;
  parentId?: string | null;
  mode: 'create' | 'edit';
  translations: {
    createTitle: string;
    editTitle: string;
    nameLabel: string;
    namePlaceholder: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    save: string;
    cancel: string;
    delete: string;
    deleteConfirm: string;
    deleteWarning: string;
    saving: string;
    deleting: string;
  };
}

export function PolicyGroupDialog({
  isOpen,
  onClose,
  onSave,
  onDelete,
  group,
  parentId,
  mode,
  translations: t,
}: PolicyGroupDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (mode === 'edit' && group) {
        setName(group.name);
        setDescription(group.description || '');
      } else {
        setName('');
        setDescription('');
      }
      setError('');
      setShowDeleteConfirm(false);
    }
  }, [isOpen, mode, group]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t.namePlaceholder);
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        parentId: mode === 'create' ? parentId ?? null : group?.parentId ?? null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;

    setDeleting(true);
    setError('');
    try {
      await onDelete();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />

      {/* Dialog */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-md transform overflow-hidden rounded-lg bg-white shadow-xl transition-all">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <div className="flex items-center">
              <Folder className="w-5 h-5 text-indigo-600 mr-2" />
              <h3 className="text-lg font-semibold text-gray-900">
                {mode === 'create' ? t.createTitle : t.editTitle}
              </h3>
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1 hover:bg-gray-100"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="px-4 py-4">
            {error && (
              <div className="mb-4 rounded-md bg-red-50 p-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {showDeleteConfirm ? (
              <div className="space-y-4">
                <div className="flex items-start">
                  <AlertTriangle className="w-5 h-5 text-amber-500 mr-2 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {t.deleteConfirm}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      {t.deleteWarning}
                    </p>
                  </div>
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                    disabled={deleting}
                  >
                    {t.cancel}
                  </button>
                  <button
                    onClick={handleDelete}
                    className="px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
                    disabled={deleting}
                  >
                    {deleting ? t.deleting : t.delete}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t.nameLabel}
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t.namePlaceholder}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t.descriptionLabel}
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t.descriptionPlaceholder}
                    rows={3}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          {!showDeleteConfirm && (
            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
              <div>
                {mode === 'edit' && onDelete && (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="text-sm font-medium text-red-600 hover:text-red-700"
                  >
                    {t.delete}
                  </button>
                )}
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={onClose}
                  className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  disabled={saving}
                >
                  {t.cancel}
                </button>
                <button
                  onClick={handleSave}
                  className="px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
                  disabled={saving}
                >
                  {saving ? t.saving : t.save}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
