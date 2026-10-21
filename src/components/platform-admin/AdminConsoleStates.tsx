import { AlertTriangle, Loader2, SearchX } from 'lucide-react';

export function AdminLoadingState({ label }: { label: string }) {
  return (
    <div className="grid min-h-64 place-items-center rounded-2xl border border-slate-200 bg-white px-6 text-center" role="status">
      <div>
        <Loader2 className="mx-auto animate-spin text-pink-700" size={28} aria-hidden="true" />
        <p className="mt-3 text-sm font-bold text-slate-600">{label}</p>
      </div>
    </div>
  );
}

export function AdminEmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 text-center">
      <div>
        <SearchX className="mx-auto text-slate-400" size={30} aria-hidden="true" />
        <h2 className="mt-3 font-black text-slate-900">{title}</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">{detail}</p>
      </div>
    </div>
  );
}

export function AdminErrorState({ title, detail, retry, retryLabel }: {
  title: string;
  detail: string;
  retry: () => void;
  retryLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-950" role="alert">
      <AlertTriangle size={24} aria-hidden="true" />
      <h2 className="mt-3 font-black">{title}</h2>
      <p className="mt-1 text-sm font-medium leading-6 text-red-800">{detail}</p>
      <button
        type="button"
        className="mt-4 min-h-11 rounded-xl bg-red-800 px-4 py-2 text-sm font-bold text-white hover:bg-red-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-900"
        onClick={retry}
      >
        {retryLabel}
      </button>
    </div>
  );
}
