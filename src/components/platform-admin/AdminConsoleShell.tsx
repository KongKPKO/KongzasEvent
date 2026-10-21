import { useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  CalendarDays,
  ChevronLeft,
  ClipboardCheck,
  Home,
  LifeBuoy,
  LogOut,
  Loader2,
  Menu,
  MessageSquareText,
  ShieldCheck,
  Store,
  Users,
  X,
} from 'lucide-react';
import { LanguageToggle, useI18n } from '../../i18n';
import { signOutLocally } from '../../utils/workspaceSession';

type AdminConsoleShellProps = {
  children: ReactNode;
  title: string;
  description: string;
  backTo?: string;
};

const navItems = [
  { path: '/admin', label: ['ภาพรวม', 'Overview'], icon: Home, exact: true },
  { path: '/admin/users', label: ['ผู้ใช้', 'Users'], icon: Users },
  { path: '/admin/creators', label: ['ครีเอเตอร์', 'Creators'], icon: Store },
  { path: '/admin/events', label: ['อีเวนต์และแคมเปญ', 'Events & campaigns'], icon: CalendarDays },
  { path: '/admin/operations', label: ['การดำเนินงาน', 'Operations'], icon: Activity },
  { path: '/admin/feedback', label: ['ข้อเสนอแนะ', 'Feedback'], icon: MessageSquareText },
  { path: '/admin/audit', label: ['บันทึกการตรวจสอบ', 'Audit logs'], icon: ShieldCheck },
] as const;

const secondaryItems = [
  { path: '/admin/applications', label: ['คำขอครีเอเตอร์', 'Applications'], icon: ClipboardCheck },
  { path: '/admin/support', label: ['ช่วยเหลือร้าน', 'Store support'], icon: LifeBuoy },
] as const;

export default function AdminConsoleShell({ children, title, description, backTo }: AdminConsoleShellProps) {
  const { language } = useI18n();
  const th = language === 'th';
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const pick = (labels: readonly [string, string]) => labels[th ? 0 : 1];

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError('');
    try {
      await signOutLocally(null);
      navigate('/manage-login', { replace: true });
    } catch {
      setSignOutError(th ? 'ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง' : 'Could not sign out. Please try again.');
      setSigningOut(false);
    }
  };

  const navLink = (item: typeof navItems[number] | typeof secondaryItems[number]) => {
    const Icon = item.icon;
    const active = 'exact' in item && item.exact
      ? location.pathname === item.path
      : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
    return (
      <NavLink
        key={item.path}
        to={item.path}
        end={'exact' in item ? item.exact : false}
        onClick={() => setMobileOpen(false)}
        className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-700 ${
          active ? 'bg-pink-50 text-pink-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
        }`}
      >
        <Icon size={18} aria-hidden="true" />
        <span>{pick(item.label)}</span>
      </NavLink>
    );
  };

  const navigation = (
    <>
      <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
        <Link to="/admin" className="flex min-h-11 items-center gap-3 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-pink-700">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-950 text-sm font-black text-white">N</span>
          <span>
            <span className="block text-sm font-black text-slate-950">Nireq</span>
            <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-pink-700">Platform admin</span>
          </span>
        </Link>
        <button
          type="button"
          className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label={th ? 'ปิดเมนู' : 'Close menu'}
        >
          <X size={20} />
        </button>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label={th ? 'เมนูผู้ดูแลแพลตฟอร์ม' : 'Platform admin navigation'}>
        {navItems.map(navLink)}
        <div className="my-3 border-t border-slate-200 pt-3">
          <p className="mb-2 px-3 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
            {th ? 'เครื่องมือเดิม' : 'Existing tools'}
          </p>
          <div className="space-y-1">{secondaryItems.map(navLink)}</div>
        </div>
      </nav>
      <div className="border-t border-slate-200 p-3">
        {signOutError && <p className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700" role="alert">{signOutError}</p>}
        <button
          type="button"
          disabled={signingOut}
          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold text-slate-600 hover:bg-red-50 hover:text-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-700 disabled:opacity-50"
          onClick={() => void signOut()}
        >
          {signingOut ? <Loader2 className="animate-spin" size={18} aria-hidden="true" /> : <LogOut size={18} aria-hidden="true" />}
          {signingOut ? (th ? 'กำลังออกจากระบบ…' : 'Signing out…') : (th ? 'ออกจากระบบ' : 'Sign out')}
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        {navigation}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/45"
            aria-label={th ? 'ปิดเมนู' : 'Close menu'}
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex h-full w-[min(20rem,88vw)] flex-col bg-white shadow-2xl">{navigation}</aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex min-h-16 max-w-[96rem] items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button
              type="button"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label={th ? 'เปิดเมนู' : 'Open menu'}
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={21} />
            </button>
            <div className="min-w-0 flex-1">
              {backTo && (
                <Link className="mb-0.5 inline-flex items-center gap-1 text-xs font-bold text-pink-700 hover:text-pink-900" to={backTo}>
                  <ChevronLeft size={14} aria-hidden="true" />
                  {th ? 'กลับไปยังรายการ' : 'Back to list'}
                </Link>
              )}
              <h1 className="truncate text-lg font-black tracking-tight sm:text-xl">{title}</h1>
              <p className="hidden truncate text-xs font-medium text-slate-500 sm:block">{description}</p>
            </div>
            <LanguageToggle />
          </div>
        </header>
        <main className="mx-auto max-w-[96rem] px-4 py-5 sm:px-6 sm:py-7 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
