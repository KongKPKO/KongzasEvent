import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n';

interface ToastMessage {
  tone?: 'info' | 'success' | 'warning' | 'error';
  title: string;
  detail?: string;
}

interface ToastProps {
  message: ToastMessage | null;
  onClose: () => void;
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  detail?: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  loading?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const toneClasses = {
  info: 'border-sky-100 bg-sky-50 text-sky-800',
  success: 'border-green-100 bg-green-50 text-green-800',
  warning: 'border-amber-100 bg-amber-50 text-amber-800',
  error: 'border-red-100 bg-red-50 text-red-700',
};

export function Toast({ message, onClose }: ToastProps) {
  const { t } = useI18n();
  if (!message) return null;

  return (
    <div className="fixed inset-x-0 top-4 z-[120] mx-auto w-[calc(100%-2rem)] max-w-md" role="status" aria-live="polite">
      <div className={`rounded-xl border p-3 shadow-lg ${toneClasses[message.tone || 'info']}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-black">{message.title}</div>
            {message.detail && <div className="mt-0.5 whitespace-pre-line text-xs font-medium opacity-90">{message.detail}</div>}
          </div>
          <button type="button" onClick={onClose} className="min-h-11 shrink-0 rounded-md px-3 text-xs font-bold opacity-70 hover:opacity-100">
            {t('commonClose')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  detail,
  children,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-gray-950/55 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
        <h2 id={titleId} className="text-lg font-black text-gray-900">{title}</h2>
        {detail && <p className="mt-2 whitespace-pre-line text-sm font-medium text-gray-600">{detail}</p>}
        {children}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            ref={cancelRef}
            onClick={onCancel}
            disabled={loading}
            className="min-h-11 rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {cancelLabel ?? t('commonCancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading || confirmDisabled}
            className={`min-h-11 rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${
              tone === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-pink-600 hover:bg-pink-700'
            }`}
          >
            {loading ? t('commonWorking') : (confirmLabel ?? t('commonConfirm'))}
          </button>
        </div>
      </div>
    </div>
  );
}
