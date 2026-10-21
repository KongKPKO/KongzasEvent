import { Building2, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { ActorWorkspace } from '../types/access';
import { uiText, useI18n } from '../i18n';
import { selectActorWorkspace } from '../utils/access';
import { signOutLocally, getDefaultWorkspacePath } from '../utils/workspaceSession';

const roleLabel = (role: ActorWorkspace['role'], language: string) => {
  const labels = {
    owner: language === 'th' ? 'เจ้าของ' : 'Owner',
    manager: language === 'th' ? 'ผู้จัดการ' : 'Manager',
    seller: language === 'th' ? 'คนขาย' : 'Seller',
    queue_staff: language === 'th' ? 'ทีมคิว' : 'Queue staff',
  };
  return labels[role];
};

export default function WorkspaceChooser({
  workspaces,
  message,
}: {
  workspaces: ActorWorkspace[];
  message?: string;
}) {
  const { language } = useI18n();
  const [choosingId, setChoosingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const logout = async () => {
    setSigningOut(true); setError('');
    try { await signOutLocally(); window.location.replace('/manage-login'); }
    catch { setError(language === 'th' ? 'ออกจากระบบไม่สำเร็จ กรุณาลองใหม่' : 'Could not sign out. Please try again.'); setSigningOut(false); }
  };

  const choose = async (workspace: ActorWorkspace) => {
    setChoosingId(workspace.artist_id);
    setError('');
    try {
      const context = await selectActorWorkspace(workspace.artist_id);
      window.location.replace(getDefaultWorkspacePath(context.role));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not switch workspace.');
      setChoosingId(null);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-12">
      <section className="mx-auto max-w-xl rounded-2xl border border-gray-200 bg-white p-5 shadow-sm md:p-7" aria-labelledby="workspace-picker-title">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-pink-50 p-2.5 text-pink-700"><Building2 size={22} aria-hidden="true" /></div>
          <div>
            <h1 id="workspace-picker-title" className="text-xl font-black text-gray-900">{uiText(language, 'Choose a workspace')}</h1>
            <p className="mt-1 text-sm text-gray-600">{uiText(language, message || 'This account can access more than one workspace. Choose where you want to work.')}</p>
          </div>
        </div>
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{uiText(language, error)}</p>}
        <div className="mt-5 grid gap-3">
          {workspaces.map((workspace) => (
            <button
              key={workspace.artist_id}
              type="button"
              disabled={choosingId !== null}
              onClick={() => void choose(workspace)}
              className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-3 text-left hover:border-pink-300 hover:bg-pink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 disabled:opacity-60"
            >
              <span className="min-w-0">
                <span className="block truncate font-black text-gray-900">{workspace.artist_name}</span>
                <span className="mt-0.5 block text-xs font-bold text-blue-700">{roleLabel(workspace.role, language)}</span>
              </span>
              {choosingId === workspace.artist_id && <Loader2 className="shrink-0 animate-spin" size={18} aria-hidden="true" />}
            </button>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap justify-between gap-3 border-t pt-4 text-sm font-bold">
          <a className="inline-flex min-h-11 items-center text-pink-700 underline" href="/help">{language === 'th' ? 'ช่วยเหลือและแจ้งปัญหา' : 'Help & feedback'}</a>
          <button className="min-h-11 rounded-xl border px-4 disabled:opacity-50" disabled={signingOut || choosingId !== null} onClick={() => void logout()}>{language === 'th' ? 'ออกจากระบบ' : 'Sign out'}</button>
        </div>
      </section>
    </main>
  );
}
