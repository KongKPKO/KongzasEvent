import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { Calendar, Coffee, Users, LogOut } from 'lucide-react';

// --- TYPES ---
interface ActiveEvent {
    id: string;
    event_name: string;
}

type ActivePage = 'events' | 'menu' | 'pos';

interface AdminHeaderProps {
    activePage: ActivePage;
    activeEvent?: ActiveEvent | null;
}

// Navigation Items Config
const navItems = [
    { path: '/manage-events', label: 'Events', icon: Calendar, page: 'events' as ActivePage },
    { path: '/manage-products', label: 'Menu', icon: Coffee, page: 'menu' as ActivePage },
    { path: '/manage-pos-queues', label: 'POS/Queue', icon: Users, page: 'pos' as ActivePage },
];

export default function AdminHeader({ activePage, activeEvent }: AdminHeaderProps) {
    const navigate = useNavigate();
    const location = useLocation();

    const handleLogout = async () => {
        await supabase.auth.signOut();
        navigate('/manage-login');
    };

    return (
        <header className="bg-white border-b border-gray-200 h-14 flex items-center justify-between px-6 shrink-0 z-20 shadow-sm">
            {/* Left: Brand + Event Badge */}
            <div className="flex items-center gap-2">
                <div className="bg-pink-500 text-white p-1.5 rounded-md font-bold text-sm">K</div>
                <span className="font-bold text-gray-800">Kongzas <span className="text-pink-500">Workspace</span></span>
                
                {/* Active Event Badge */}
                {activeEvent && (
                    <div className="ml-3 px-2 py-0.5 bg-green-50 border border-green-200 rounded-full text-xs font-bold text-green-700 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                        {activeEvent.event_name}
                    </div>
                )}
                {activeEvent === null && (
                    <div className="ml-3 px-2 py-0.5 bg-red-50 border border-red-200 rounded-full text-xs font-bold text-red-600">
                        ⚠️ No Active Event
                    </div>
                )}
            </div>

            {/* Right: Navigation Links */}
            <div className="flex items-center gap-1">
                {navItems.map((item) => {
                    const Icon = item.icon;
                    // Check if active by prop OR by current path
                    const isActive = activePage === item.page || location.pathname === item.path;
                    
                    return (
                        <button
                            key={item.path}
                            onClick={() => navigate(item.path)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                                isActive
                                    ? 'bg-pink-50 text-pink-600 border border-pink-200'
                                    : 'text-gray-500 hover:text-pink-500 hover:bg-gray-50'
                            }`}
                        >
                            <Icon size={14} />
                            <span className="hidden sm:inline">{item.label}</span>
                        </button>
                    );
                })}
                
                <div className="h-5 w-px bg-gray-200 mx-2"></div>
                
                <button 
                    onClick={handleLogout} 
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-400 hover:text-red-500 hover:bg-red-50 flex items-center gap-1.5 transition-all"
                >
                    <LogOut size={14} />
                    <span className="hidden sm:inline">Logout</span>
                </button>
            </div>
        </header>
    );
}
