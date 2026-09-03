import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { AlertTriangle, Calendar, Coffee, Sparkles, UserCog, LogOut, Menu, X, ClipboardCheck, ShoppingBag } from 'lucide-react';
import type { ActorRole } from '../types/access';
import { LanguageToggle, useI18n } from '../i18n';

// --- TYPES ---
interface ActiveEvent {
    id: string;
    event_name: string;
}

type ActivePage = 'events' | 'menu' | 'promotion' | 'pos' | 'online-sales';
type VisiblePage = ActivePage | 'team';

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
    { path: '/manage-events', label: 'Events', icon: Calendar, page: 'events' as VisiblePage, roles: ['owner', 'manager'] as ActorRole[], group: 'setup' as const },
    { path: '/manage-online-sales', label: 'Online Sales', icon: ShoppingBag, page: 'online-sales' as VisiblePage, roles: ['owner', 'manager', 'seller'] as ActorRole[], group: 'setup' as const },
    { path: '/manage-products', label: 'Catalog', icon: Coffee, page: 'menu' as VisiblePage, roles: ['owner', 'manager'] as ActorRole[], group: 'setup' as const },
    { path: '/manage-promotions', label: 'Promotion', icon: Sparkles, page: 'promotion' as VisiblePage, roles: ['owner', 'manager'] as ActorRole[], group: 'setup' as const },
    { path: '/manage-team', label: 'Team', icon: UserCog, page: 'team' as VisiblePage, roles: ['owner'] as ActorRole[], group: 'setup' as const },
];

const getNavLabel = (page: Exclude<VisiblePage, 'promotion'>) => {
    if (page === 'events') return 'workspaceNavEvents';
    if (page === 'online-sales') return 'workspaceNavOnlineSales';
    if (page === 'menu') return 'workspaceNavMenu';
    if (page === 'pos') return 'workspaceNavPosQueue';
    return 'workspaceNavTeam';
};

export default function AdminHeader({ activePage, activeEvent, actorRole = 'owner', userEmail: contextEmail = null }: AdminHeaderProps) {
    const { t } = useI18n();
    const navigate = useNavigate();
    const location = useLocation();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [userEmail, setUserEmail] = useState<string | null>(contextEmail);
    const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
    const filteredNavItems = navItems.filter((item) => item.roles.includes(actorRole));

    useEffect(() => {
        const fetchUser = async () => {
            if (contextEmail) {
                setUserEmail(contextEmail);
            } else {
                const { data: sessionData } = await supabase.auth.getSession();
                if (sessionData.session?.user?.email) {
                    setUserEmail(sessionData.session.user.email);
                }

                const { data: { user } } = await supabase.auth.getUser();
                if (user?.email) {
                    setUserEmail(user.email);
                }
            }

            const { data: adminAccess, error } = await supabase.rpc('is_platform_admin');
            if (!error) {
                setIsPlatformAdmin(Boolean(adminAccess));
            }
        };
        fetchUser();
    }, [contextEmail]);

    const roleLabelMapping: Record<string, string> = {
        owner: t('workspaceRoleOwner'),
        manager: t('workspaceRoleManager'),
        seller: t('workspaceRoleSeller'),
        queue_staff: t('workspaceRoleQueueStaff'),
    };
    
    const displayRole = actorRole ? (roleLabelMapping[actorRole] || actorRole) : 'Admin';
    const displayEmail = userEmail || contextEmail || 'Signed in';
    const firstLetter = displayEmail ? displayEmail.charAt(0).toUpperCase() : 'U';

    const handleLogout = async () => {
        await supabase.auth.signOut();
        window.location.replace('/manage-login');
    };

    return (
        <header className="bg-white border-b border-gray-200 min-h-14 flex items-center justify-between px-4 md:px-6 shrink-0 z-20 shadow-sm relative">
            {/* Left: Brand + Event Badge */}
            <div className="flex items-center gap-2">
                <div className="bg-pink-500 text-white p-1.5 rounded-md font-bold text-sm">K</div>
                <span className="font-bold text-gray-800 hidden md:inline">Nire<span className="text-pink-600">q</span> Workspace</span>
                <span className="font-bold text-gray-800 md:hidden">Nireq</span>
                
                {/* Active Event Badge */}
                {activeEvent && (
                    <div className="ml-2 md:ml-3 px-2.5 py-1 bg-pink-50 border border-pink-200 rounded-full text-xs font-bold text-pink-700 flex items-center gap-1.5 max-w-[140px] md:max-w-none">
                        <span className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse shrink-0"></span>
                        <span className="truncate">{activeEvent.event_name}</span>
                    </div>
                )}
                {activeEvent === null && (
                    <div className="ml-2 md:ml-3 px-2.5 py-1 bg-red-50 border border-red-200 rounded-full text-xs font-bold text-red-600 inline-flex items-center gap-1.5">
                        <AlertTriangle size={13} aria-hidden="true" />
                        <span className="md:hidden">No Event</span>
                        <span className="hidden md:inline">No Active Event</span>
                    </div>
                )}
            </div>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-1">
                {filteredNavItems.map((item) => {
                    const Icon = item.icon;
                    // Highlight Live nav whether the user is on /live/queue, /live/pos, or the legacy /manage-pos-queues
                    const isLiveItem = item.page === 'pos';
                    const isActive =
                        activePage === item.page ||
                        location.pathname === item.path ||
                        (isLiveItem && (location.pathname.startsWith('/live') || location.pathname === '/manage-pos-queues'));
                    const label = item.page === 'promotion' ? item.label : t(getNavLabel(item.page));
                    
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
                <LanguageToggle className="workspace-action px-2 py-2" />
                <div className="h-5 w-px bg-gray-200 mx-1"></div>

                {/* Profile Indicator (Desktop) */}
                <div className="min-h-11 flex items-center gap-2 mr-2 group relative cursor-pointer hover:bg-gray-50 p-1.5 rounded-lg transition-colors">
                    <div className="w-7 h-7 rounded-sm bg-pink-100 flex items-center justify-center text-pink-600 font-bold text-xs ring-1 ring-pink-200">
                        {firstLetter}
                    </div>
                    <div className="hidden lg:flex flex-col items-start leading-none max-w-[140px]">
                        <span className="text-[11px] font-semibold text-gray-700 truncate w-full">{displayEmail}</span>
                        <div className="flex items-center gap-1 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                            <span className="text-[9px] font-medium text-gray-500 uppercase tracking-wide">{displayRole}</span>
                        </div>
                    </div>
                    {/* Tooltip for smaller desktop screens */}
                    <div className="absolute top-10 right-0 lg:hidden bg-gray-800 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                        {displayEmail} • {displayRole}
                    </div>
                </div>

                <div className="h-5 w-px bg-gray-200 mr-2"></div>
                
                <button 
                    onClick={handleLogout} 
                    className="workspace-action px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 hover:text-red-700 hover:bg-gray-50 flex items-center gap-1.5 transition-all"
                    aria-label={t('signOut')}
                >
                    <LogOut size={14} aria-hidden="true" />
                    <span className="hidden sm:inline">{t('signOut')}</span>
                </button>
            </div>

            {/* Mobile Menu Button */}
            <button 
                className="md:hidden icon-touch inline-flex items-center justify-center text-gray-600 hover:bg-gray-100 rounded-lg"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                aria-label={isMenuOpen ? 'Close workspace menu' : 'Open workspace menu'}
            >
                {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

            {/* Mobile Dropdown Menu */}
            {isMenuOpen && (
                <div className="absolute top-14 left-0 right-0 bg-white border-b border-gray-200 shadow-lg md:hidden flex flex-col p-4 gap-2 animate-in slide-in-from-top-2 duration-200">
                    {/* Profile Information (Mobile) */}
                    <div className="flex items-center gap-3 px-4 py-2 mb-2 bg-gray-50 rounded-lg">
                        <div className="w-10 h-10 rounded-md bg-pink-100 flex items-center justify-center text-pink-600 font-bold text-sm ring-1 ring-pink-200">
                            {firstLetter}
                        </div>
                        <div className="flex flex-col">
                            <span className="text-sm font-semibold text-gray-800 truncate max-w-[200px]">{displayEmail}</span>
                            <span className="text-xs font-medium text-blue-600 uppercase mt-0.5">{displayRole}</span>
                        </div>
                    </div>
                    <div className="h-px bg-gray-100 my-1"></div>

                    {filteredNavItems.map((item) => {
                        const Icon = item.icon;
                        // Highlight Live nav whether the user is on /live/queue, /live/pos, or the legacy /manage-pos-queues
                    const isLiveItem = item.page === 'pos';
                        const isActive =
                        activePage === item.page ||
                        location.pathname === item.path ||
                        (isLiveItem && (location.pathname.startsWith('/live') || location.pathname === '/manage-pos-queues'));
                        const label = item.page === 'promotion' ? item.label : t(getNavLabel(item.page));
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
                    <div className="h-px bg-gray-100 my-1"></div>
                    <div className="px-4 py-2">
                        <LanguageToggle />
                    </div>
                    <div className="h-px bg-gray-100 my-1"></div>
                    <button 
                        onClick={handleLogout}
                        className="w-full min-h-12 text-left px-4 py-3 rounded-lg text-sm font-semibold text-red-600 hover:bg-red-50 flex items-center gap-3"
                        aria-label={t('signOut')}
                    >
                        <LogOut size={18} />
                        {t('signOut')}
                    </button>
                </div>
            )}
        </header>
    );
}
