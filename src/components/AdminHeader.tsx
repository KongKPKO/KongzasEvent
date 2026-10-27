import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { AlertTriangle, Calendar, Coffee, Sparkles, UserCog, Menu, X, ClipboardCheck, ShoppingBag } from 'lucide-react';
import type { ActorRole } from '../types/access';
import { LanguageToggle, useI18n , uiText} from '../i18n';
import AccountMenu from './AccountMenu';
import { BrandWordmark } from './BrandMark';

// --- TYPES ---
interface ActiveEvent {
    id: string;
    event_name: string;
}

type ActivePage = 'events' | 'menu' | 'promotion' | 'pos' | 'online-sales';
type VisiblePage = ActivePage | 'team' | 'problems';

interface AdminHeaderProps {
    activePage: VisiblePage;
    activeEvent?: ActiveEvent | null;
    actorRole?: ActorRole;
    userEmail?: string | null;
}

// Navigation Items Config
// Setup-mode items (configuration-oriented, used before/between events)
// Live-mode items (operational, used during events)
const navItems = [
    { path: '/manage-order-problems', label: 'Order problems', icon: ClipboardCheck, page: 'problems' as VisiblePage, roles: ['owner', 'manager'] as ActorRole[], group: 'setup' as const },
    { path: '/manage-events', label: 'Events', icon: Calendar, page: 'events' as VisiblePage, roles: ['owner', 'manager'] as ActorRole[], group: 'setup' as const },
    { path: '/manage-online-sales', label: 'Online Sales', icon: ShoppingBag, page: 'online-sales' as VisiblePage, roles: ['owner', 'manager', 'seller'] as ActorRole[], group: 'setup' as const },
    { path: '/manage-products', label: 'Catalog', icon: Coffee, page: 'menu' as VisiblePage, roles: ['owner', 'manager'] as ActorRole[], group: 'setup' as const },
    { path: '/manage-promotions', label: 'Promotion', icon: Sparkles, page: 'promotion' as VisiblePage, roles: ['owner', 'manager'] as ActorRole[], group: 'setup' as const },
    { path: '/manage-team', label: 'Team', icon: UserCog, page: 'team' as VisiblePage, roles: ['owner', 'manager'] as ActorRole[], group: 'setup' as const },
];

const getNavLabel = (page: Exclude<VisiblePage, 'promotion'>) => {
    if (page === 'events') return 'workspaceNavEvents';
    if (page === 'online-sales') return 'workspaceNavOnlineSales';
    if (page === 'menu') return 'workspaceNavMenu';
    if (page === 'pos') return 'workspaceNavPosQueue';
    return 'workspaceNavTeam';
};

export default function AdminHeader({ activePage, activeEvent, actorRole, userEmail: contextEmail = null }: AdminHeaderProps) {
    const { t, language } = useI18n();
    const navigate = useNavigate();
    const location = useLocation();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
    const filteredNavItems = navItems.filter((item) => item.roles.includes(actorRole || 'owner'));

    useEffect(() => {
        const fetchUser = async () => {
            const { data: adminAccess, error } = await supabase.rpc('is_platform_admin_account');
            if (!error) {
                setIsPlatformAdmin(Boolean(adminAccess));
            }
        };
        fetchUser();
    }, [contextEmail]);

    return (
        <header className="festival-header bg-white border-b border-gray-200 min-h-14 flex items-center justify-between px-4 md:px-6 shrink-0 z-40 shadow-sm relative">
            {/* Left: Brand + Event Badge */}
            <div className="flex min-w-0 flex-1 items-center gap-2 xl:flex-none">
                <Link to="/manage-events" aria-label={language === 'th' ? 'หน้าหลักร้าน' : 'Shop workspace'} className="festival-wordmark shrink-0">
                    <BrandWordmark className="festival-brand-mark" size={17} />
                </Link>
                {/* Active Event Badge */}
                {activeEvent && (
                    <div className="ml-2 md:ml-3 px-2.5 py-1 bg-pink-50 border border-pink-200 rounded-full text-xs font-bold text-pink-700 flex min-w-0 items-center gap-1.5 max-w-[140px] md:max-w-none">
                        <span className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse shrink-0"></span>
                        <span className="truncate">{activeEvent.event_name}</span>
                    </div>
                )}
                {activeEvent === null && (
                    <div className="ml-2 md:ml-3 px-2.5 py-1 bg-red-50 border border-red-200 rounded-full text-xs font-bold text-red-600 inline-flex items-center gap-1.5">
                        <AlertTriangle size={13} aria-hidden="true" />
                        <span className="md:hidden">{uiText(language, "No Event")}</span>
                        <span className="hidden md:inline">{uiText(language, "No Active Event")}</span>
                    </div>
                )}
            </div>

            {/* Desktop Navigation */}
            <div className="hidden xl:flex items-center gap-1">
                {filteredNavItems.map((item) => {
                    const Icon = item.icon;
                    // Highlight Live nav whether the user is on /live/queue, /live/pos, or the legacy /manage-pos-queues
                    const isLiveItem = item.page === 'pos';
                    const isActive =
                        activePage === item.page ||
                        location.pathname === item.path ||
                        (isLiveItem && (location.pathname.startsWith('/live') || location.pathname === '/manage-pos-queues'));
                    const label = item.page === 'problems' ? (language === 'th' ? 'ปัญหาออเดอร์' : 'Order problems') : item.page === 'promotion' ? (language === 'th' ? 'โปรโมชัน' : item.label) : t(getNavLabel(item.page));

                    return (
                        <button
                            key={item.path}
                            onClick={() => navigate(item.path)}
                            className={`workspace-action px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                                isActive
                                    ? 'bg-pink-50 text-pink-700 border border-pink-200'
                                    : 'text-gray-600 hover:text-pink-600 hover:bg-gray-50'
                            }`}
                            aria-label={label}
                            aria-current={isActive ? 'page' : undefined}
                        >
                            <Icon size={14} aria-hidden="true" />
                            <span className="hidden sm:inline">{label}</span>
                        </button>
                    );
                })}

                {isPlatformAdmin && (
                    <button
                        onClick={() => navigate('/admin/applications')}
                        className={`workspace-action px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                            location.pathname === '/admin/applications'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'text-slate-700 hover:text-emerald-700 hover:bg-gray-50'
                        }`}
                        aria-label={t('workspaceNavApplications')}
                    >
                        <ClipboardCheck size={14} aria-hidden="true" />
                        <span className="hidden sm:inline">{t('workspaceNavApplications')}</span>
                    </button>
                )}

                <div className="h-5 w-px bg-gray-200 mx-1"></div>
                {isPlatformAdmin && <Link to="/admin" className="min-h-11 inline-flex items-center px-3 text-xs font-bold text-pink-700">{language === 'th' ? 'ศูนย์ผู้ดูแล' : 'Admin console'}</Link>}
                <LanguageToggle className="workspace-action px-2 py-2" />
                <div className="h-5 w-px bg-gray-200 mx-1"></div>

                <AccountMenu actorRole={actorRole} userEmail={contextEmail} />
            </div>

            {/* Mobile Menu Button */}
            <button
                className="xl:hidden icon-touch inline-flex shrink-0 items-center justify-center text-gray-600 hover:bg-gray-100 rounded-lg"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                aria-expanded={isMenuOpen} aria-controls="workspace-menu" aria-label={isMenuOpen ? (language === 'th' ? 'ปิดเมนู' : 'Close workspace menu') : (language === 'th' ? 'เปิดเมนู' : 'Open workspace menu')}
            >
                {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

            {/* Mobile Dropdown Menu */}
            {isMenuOpen && (
                <div id="workspace-menu" className="max-h-[calc(100dvh-4rem)] overflow-y-auto absolute top-full left-0 right-0 bg-white border-b border-gray-200 shadow-lg xl:hidden flex flex-col p-4 gap-2 animate-in slide-in-from-top-2 duration-200">
                    <AccountMenu actorRole={actorRole} userEmail={contextEmail} inline />
                    <div className="h-px bg-gray-100 my-1"></div>
                    {filteredNavItems.map((item) => {
                        const Icon = item.icon;
                        // Highlight Live nav whether the user is on /live/queue, /live/pos, or the legacy /manage-pos-queues
                    const isLiveItem = item.page === 'pos';
                        const isActive =
                        activePage === item.page ||
                        location.pathname === item.path ||
                        (isLiveItem && (location.pathname.startsWith('/live') || location.pathname === '/manage-pos-queues'));
                        const label = item.page === 'problems' ? (language === 'th' ? 'ปัญหาออเดอร์' : 'Order problems') : item.page === 'promotion' ? (language === 'th' ? 'โปรโมชัน' : item.label) : t(getNavLabel(item.page));
                        return (
                            <button
                                key={item.path}
                                onClick={() => {
                                    navigate(item.path);
                                    setIsMenuOpen(false);
                                }}
                                className={`w-full min-h-12 text-left px-4 py-3 rounded-lg text-sm font-semibold flex items-center gap-3 transition-all ${
                                    isActive
                                        ? 'bg-pink-50 text-pink-700 border border-pink-200'
                                        : 'text-gray-600 hover:bg-gray-50'
                                }`}
                                aria-label={label}
                                aria-current={isActive ? 'page' : undefined}
                            >
                                <Icon size={18} />
                                {label}
                            </button>
                        );
                    })}
                    {isPlatformAdmin && (
                        <button
                            onClick={() => {
                                navigate('/admin/applications');
                                setIsMenuOpen(false);
                            }}
                            className={`w-full min-h-12 text-left px-4 py-3 rounded-lg text-sm font-semibold flex items-center gap-3 transition-all ${
                                location.pathname === '/admin/applications'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : 'text-slate-700 hover:bg-gray-50 hover:text-emerald-700'
                            }`}
                            aria-label={t('workspaceNavApplications')}
                        >
                            <ClipboardCheck size={18} />
                            {t('workspaceNavApplications')}
                        </button>
                    )}
                    {isPlatformAdmin && <Link to="/admin" onClick={() => setIsMenuOpen(false)} className="block min-h-12 px-4 py-3 text-sm font-bold text-pink-700">{language === 'th' ? 'ศูนย์ผู้ดูแล' : 'Admin console'}</Link>}
                    <div className="h-px bg-gray-100 my-1"></div>
                    <Link to="/help" onClick={() => setIsMenuOpen(false)} className="block min-h-12 px-4 py-3 text-sm font-bold text-pink-700">{language === 'th' ? 'ช่วยเหลือและนโยบาย' : 'Help and policies'}</Link>
                    <div className="px-4 py-2">
                        <LanguageToggle />
                    </div>
                </div>
            )}
        </header>
    );
}
