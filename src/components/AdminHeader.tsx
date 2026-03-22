import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { Calendar, Coffee, Users, UserCog, LogOut, Menu, X } from 'lucide-react';
import type { ActorRole } from '../types/access';

// --- TYPES ---
interface ActiveEvent {
    id: string;
    event_name: string;
}

type ActivePage = 'events' | 'menu' | 'pos';
type VisiblePage = ActivePage | 'team';

interface AdminHeaderProps {
    activePage: VisiblePage;
    activeEvent?: ActiveEvent | null;
    actorRole?: ActorRole;
}

// Navigation Items Config
const navItems = [
    { path: '/manage-events', label: 'Events', icon: Calendar, page: 'events' as VisiblePage, roles: ['owner'] as ActorRole[] },
    { path: '/manage-products', label: 'Menu', icon: Coffee, page: 'menu' as VisiblePage, roles: ['owner'] as ActorRole[] },
    { path: '/manage-pos-queues', label: 'POS/Queue', icon: Users, page: 'pos' as VisiblePage, roles: ['owner', 'queue_only', 'queue_pos'] as ActorRole[] },
    { path: '/manage-team', label: 'Team', icon: UserCog, page: 'team' as VisiblePage, roles: ['owner'] as ActorRole[] },
];

export default function AdminHeader({ activePage, activeEvent, actorRole = 'owner' }: AdminHeaderProps) {
    const navigate = useNavigate();
    const location = useLocation();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [userEmail, setUserEmail] = useState<string | null>(null);
    const filteredNavItems = navItems.filter((item) => item.roles.includes(actorRole));

    useEffect(() => {
        const fetchUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user?.email) {
                setUserEmail(user.email);
            }
        };
        fetchUser();
    }, []);

    const roleLabelMapping: Record<string, string> = {
        owner: 'Owner',
        queue_only: 'Queue Staff',
        queue_pos: 'Queue & POS Staff',
    };
    
    const displayRole = actorRole ? (roleLabelMapping[actorRole] || actorRole) : 'Admin';
    const firstLetter = userEmail ? userEmail.charAt(0).toUpperCase() : 'U';

    const handleLogout = async () => {
        await supabase.auth.signOut();
        navigate('/manage-login');
    };

    return (
        <header className="bg-white border-b border-gray-200 h-14 flex items-center justify-between px-4 md:px-6 shrink-0 z-20 shadow-sm relative">
            {/* Left: Brand + Event Badge */}
            <div className="flex items-center gap-2">
                <div className="bg-pink-500 text-white p-1.5 rounded-md font-bold text-sm">K</div>
                <span className="font-bold text-gray-800 hidden md:inline">Kongzas <span className="text-pink-600">Workspace</span></span>
                <span className="font-bold text-gray-800 md:hidden">Kongzas</span>
                
                {/* Active Event Badge */}
                {activeEvent && (
                    <div className="ml-2 md:ml-3 px-2 py-0.5 bg-green-50 border border-green-200 rounded-full text-xs font-bold text-green-700 flex items-center gap-1 max-w-[120px] md:max-w-none">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0"></span>
                        <span className="truncate">{activeEvent.event_name}</span>
                    </div>
                )}
                {activeEvent === null && (
                    <div className="ml-2 md:ml-3 px-2 py-0.5 bg-red-50 border border-red-200 rounded-full text-xs font-bold text-red-600">
                        <span className="md:hidden">No Event</span>
                        <span className="hidden md:inline">⚠️ No Active Event</span>
                    </div>
                )}
            </div>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-1">
                {filteredNavItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = activePage === item.page || location.pathname === item.path;
                    
                    return (
                        <button
                            key={item.path}
                            onClick={() => navigate(item.path)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                                isActive
                                    ? 'bg-pink-50 text-pink-700 border border-pink-200'
                                    : 'text-gray-600 hover:text-pink-600 hover:bg-gray-50'
                            }`}
                            aria-label={item.label}
                        >
                            <Icon size={14} aria-hidden="true" />
                            <span className="hidden sm:inline">{item.label}</span>
                        </button>
                    );
                })}
                
                <div className="h-5 w-px bg-gray-200 mx-1"></div>

                {/* Profile Indicator (Desktop) */}
                <div className="flex items-center gap-2 mr-2 group relative cursor-pointer hover:bg-gray-50 p-1.5 rounded-lg transition-colors">
                    <div className="w-7 h-7 rounded-sm bg-pink-100 flex items-center justify-center text-pink-600 font-bold text-xs ring-1 ring-pink-200">
                        {firstLetter}
                    </div>
                    <div className="hidden lg:flex flex-col items-start leading-none max-w-[140px]">
                        <span className="text-[11px] font-semibold text-gray-700 truncate w-full">{userEmail || 'Loading...'}</span>
                        <div className="flex items-center gap-1 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                            <span className="text-[9px] font-medium text-gray-500 uppercase tracking-wide">{displayRole}</span>
                        </div>
                    </div>
                    {/* Tooltip for smaller desktop screens */}
                    <div className="absolute top-10 right-0 lg:hidden bg-gray-800 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                        {userEmail} • {displayRole}
                    </div>
                </div>

                <div className="h-5 w-px bg-gray-200 mr-2"></div>
                
                <button 
                    onClick={handleLogout} 
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 hover:text-red-600 hover:bg-red-50 flex items-center gap-1.5 transition-all"
                    aria-label="Logout"
                >
                    <LogOut size={14} aria-hidden="true" />
                    <span className="hidden sm:inline">Logout</span>
                </button>
            </div>

            {/* Mobile Menu Button */}
            <button 
                className="md:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
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
                            <span className="text-sm font-semibold text-gray-800 truncate max-w-[200px]">{userEmail || 'Loading...'}</span>
                            <span className="text-xs font-medium text-blue-600 uppercase mt-0.5">{displayRole}</span>
                        </div>
                    </div>
                    <div className="h-px bg-gray-100 my-1"></div>

                    {filteredNavItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = activePage === item.page || location.pathname === item.path;
                        return (
                            <button
                                key={item.path}
                                onClick={() => {
                                    navigate(item.path);
                                    setIsMenuOpen(false);
                                }}
                                className={`w-full text-left px-4 py-3 rounded-lg text-sm font-semibold flex items-center gap-3 transition-all ${
                                    isActive
                                        ? 'bg-pink-50 text-pink-700 border border-pink-200'
                                        : 'text-gray-600 hover:bg-gray-50'
                                }`}
                            >
                                <Icon size={18} />
                                {item.label}
                            </button>
                        );
                    })}
                    <div className="h-px bg-gray-100 my-1"></div>
                    <button 
                        onClick={handleLogout}
                        className="w-full text-left px-4 py-3 rounded-lg text-sm font-semibold text-red-600 hover:bg-red-50 flex items-center gap-3"
                    >
                        <LogOut size={18} />
                        Logout
                    </button>
                </div>
            )}
        </header>
    );
}
