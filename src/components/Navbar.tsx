// import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Coffee, Users } from 'lucide-react';
import { uiText, useI18n } from '../i18n';
import { BrandWordmark } from './BrandMark';

export const Navbar = () => {
  const { language } = useI18n();
  return (
    <nav className="fixed top-0 left-0 right-0 bg-white/95 backdrop-blur-md border-b border-gray-200 z-50 pb-2">
      <div className="max-w-md mx-auto flex flex-col items-center px-4 pt-3 pb-2">
        {/* Brand */}
        <div className="brand-navbar-wordmark mb-3 font-bold text-xl tracking-normal">
          <BrandWordmark size={19} />
        </div>

        {/* Navigation Links */}
        <div className="flex gap-4 w-full justify-center">
          <NavLink 
            to="/" 
            className={({ isActive }) =>
              `flex flex-col items-center justify-center w-20 h-20 rounded-2xl transition-all duration-200 shadow-sm border ${
                isActive
                  ? 'scale-105 border-pink-600 text-pink-600 shadow-md'
                  : 'border-gray-200 text-gray-400 hover:bg-gray-50'
              }`
            }
          >
            <Home size={28} />
            <span className="text-xs font-bold mt-1">{uiText(language, 'Home')}</span>
          </NavLink>

          <NavLink 
            to="/menu" 
            className={({ isActive }) =>
              `flex flex-col items-center justify-center w-20 h-20 rounded-2xl transition-all duration-200 shadow-sm border ${
                isActive
                  ? 'scale-105 border-pink-600 text-pink-600 shadow-md'
                  : 'border-gray-200 text-gray-400 hover:bg-gray-50'
              }`
            }
          >
            <Coffee size={28} />
            <span className="text-xs font-bold mt-1">{uiText(language, 'Menu')}</span>
          </NavLink>

          <NavLink 
            to="/queue" 
            className={({ isActive }) =>
              `flex flex-col items-center justify-center w-20 h-20 rounded-2xl transition-all duration-200 shadow-sm border ${
                isActive
                  ? 'scale-105 border-pink-600 text-pink-600 shadow-md'
                  : 'border-gray-200 text-gray-400 hover:bg-gray-50'
              }`
            }
          >
            <Users size={28} />
            <span className="text-xs font-bold mt-1">{uiText(language, 'Queue')}</span>
          </NavLink>
        </div>
      </div>
    </nav>
  );
};
