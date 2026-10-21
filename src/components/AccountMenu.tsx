import { Building2, ChevronDown, HelpCircle, Loader2, LogOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ActorRole, ActorWorkspace } from '../types/access';
import { uiText, useI18n } from '../i18n';
import { listActorWorkspaces, selectActorWorkspace } from '../utils/access';
import { getAuthUserSafe } from '../utils/auth';
import { getDefaultWorkspacePath, getSelectedWorkspaceId, signOutLocally } from '../utils/workspaceSession';

const roleLabel = (role: ActorRole, language: string) => ({
  owner: language === 'th' ? 'เจ้าของ' : 'Owner',
  manager: language === 'th' ? 'ผู้จัดการ' : 'Manager',
  seller: language === 'th' ? 'คนขาย' : 'Seller',
  queue_staff: language === 'th' ? 'ทีมคิว' : 'Queue staff',
})[role];

export default function AccountMenu({
  actorRole,
  userEmail,
  inline = false,
}: {
  actorRole: ActorRole;
  userEmail?: string | null;
  inline?: boolean;
}) {
  const { language } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(inline);
  const [email, setEmail] = useState(userEmail || '');
  const [userId, setUserId] = useState('');
  const [workspaces, setWorkspaces] = useState<ActorWorkspace[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [switchingId, setSwitchingId] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void Promise.all([getAuthUserSafe(), listActorWorkspaces()]).then(([user, rows]) => {
      if (!active) return;
      setEmail(userEmail || user?.email || '');
      setUserId(user?.id || '');
      setWorkspaces(rows);
      setSelectedId(user ? getSelectedWorkspaceId(user.id) || '' : '');
    }).catch((failure) => {
      if (active) setError(failure instanceof Error ? failure.message : 'Could not load account details.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [userEmail]);

  useEffect(() => {
    if (inline || !open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); rootRef.current?.querySelector('button')?.focus(); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [inline, open]);

  const switchWorkspace = async (workspace: ActorWorkspace) => {
    if (workspace.artist_id === selectedId || switchingId) return;
    setSwitchingId(workspace.artist_id);
    setError('');
    try {
      const context = await selectActorWorkspace(workspace.artist_id);
      window.location.replace(getDefaultWorkspacePath(context.role));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not switch workspace.');
      setSwitchingId('');
    }
  };

  const logout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setError('');
    try {
      await signOutLocally(userId || null);
      window.location.replace('/manage-login');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not sign out. Please try again.');
      setSigningOut(false);
    }
  };

  const selected = workspaces.find((workspace) => workspace.artist_id === selectedId);
  const panel = (
    <div className={inline ? 'space-y-2' : 'absolute right-0 top-12 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-3 shadow-xl'}>
      <div className="rounded-lg bg-gray-50 px-3 py-2">
        <p className="truncate text-sm font-bold text-gray-900">{email || uiText(language, 'Signed in')}</p>
        <p className="mt-0.5 truncate text-xs font-semibold text-gray-500">{selected?.artist_name || uiText(language, 'Workspace')} · {roleLabel(actorRole, language)}</p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{uiText(language, error)}</p>}
      {loading ? (
        <div className="flex min-h-11 items-center gap-2 px-3 text-sm text-gray-500"><Loader2 className="animate-spin" size={16} />{uiText(language, 'Loading workspaces…')}</div>
      ) : workspaces.length > 1 ? (
        <div aria-label={uiText(language, 'Switch workspace')} className="space-y-1">
          <p className="px-3 pt-1 text-[11px] font-black uppercase tracking-wide text-gray-400">{uiText(language, 'Switch workspace')}</p>
          {workspaces.map((workspace) => (
            <button
              key={workspace.artist_id}
              type="button"
              disabled={Boolean(switchingId)}
              onClick={() => void switchWorkspace(workspace)}
              className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-60 ${workspace.artist_id === selectedId ? 'bg-pink-50 text-pink-800' : 'text-gray-700'}`}
            >
              <Building2 size={16} className="shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1"><span className="block truncate font-bold">{workspace.artist_name}</span><span className="block text-xs opacity-70">{roleLabel(workspace.role, language)}</span></span>
              {switchingId === workspace.artist_id && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
            </button>
          ))}
        </div>
      ) : null}
      <div className="h-px bg-gray-100" />
      <Link to="/help" className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50" onClick={() => setOpen(false)}>
        <HelpCircle size={17} aria-hidden="true" />{uiText(language, 'Help and report a problem')}
      </Link>
      <button type="button" disabled={signingOut} onClick={() => void logout()} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-60">
        {signingOut ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <LogOut size={17} aria-hidden="true" />}
        {uiText(language, signingOut ? 'Signing out…' : 'Sign out')}
      </button>
    </div>
  );

  if (inline) return <div ref={rootRef}>{panel}</div>;
  return (
    <div ref={rootRef} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-label={`${language === 'th' ? 'บัญชี' : 'Account'}: ${selected?.artist_name || email || 'User'}`} aria-expanded={open} className="workspace-action flex min-h-11 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-gray-50">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-pink-100 text-xs font-black text-pink-700">{(email || 'U').charAt(0).toUpperCase()}</span>
        <span className="hidden max-w-[150px] lg:block"><span className="block truncate text-[11px] font-bold text-gray-800">{selected?.artist_name || email || uiText(language, 'Account')}</span><span className="block text-[10px] font-semibold text-gray-500">{roleLabel(actorRole, language)}</span></span>
        <ChevronDown size={14} className="text-gray-400" aria-hidden="true" />
      </button>
      {open && panel}
    </div>
  );
}
