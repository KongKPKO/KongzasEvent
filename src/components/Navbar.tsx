// import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Coffee, Users } from 'lucide-react';

export const Navbar = () => {
  return (
    <nav className="fixed top-0 left-0 right-0 bg-white/95 backdrop-blur-md border-b border-gray-200 z-50 pb-2">
      <div className="max-w-md mx-auto flex flex-col items-center px-4 pt-3 pb-2">
        {/* Brand */}
        <div className="font-bold text-xl tracking-wider uppercase mb-3" style={{ color: '#ee81a3' }}>Kongzas</div>

        {/* Navigation Links */}
        <div className="flex gap-4 w-full justify-center">
          <NavLink 
            to="/" 
            className={({ isActive }) => 
              `flex flex-col items-center justify-center w-20 h-20 rounded-2xl transition-all duration-200 shadow-sm border ${
                isActive 
                  ? 'shadow-md scale-105' 
                  : 'hover:bg-gray-50'
              }`
            }
            style={({ isActive }) => ({
              backgroundColor: 'transparent',
              color: isActive ? '#ee81a3' : '#9ca3af',
              borderColor: isActive ? '#ee81a3' : '#e5e7eb'
            })}
          >
            <Home size={28} />
            <span className="text-xs font-bold mt-1">Home</span>
          </NavLink>

          <NavLink 
            to="/menu" 
            className={({ isActive }) => 
              `flex flex-col items-center justify-center w-20 h-20 rounded-2xl transition-all duration-200 shadow-sm border ${
                isActive 
                  ? 'shadow-md scale-105' 
                  : 'hover:bg-gray-50'
              }`
            }
            style={({ isActive }) => ({
              backgroundColor: 'transparent',
              color: isActive ? '#ee81a3' : '#9ca3af',
              borderColor: isActive ? '#ee81a3' : '#e5e7eb'
            })}
          >
            <Coffee size={28} />
            <span className="text-xs font-bold mt-1">Menu</span>
          </NavLink>

          <NavLink 
            to="/queue" 
            className={({ isActive }) => 
              `flex flex-col items-center justify-center w-20 h-20 rounded-2xl transition-all duration-200 shadow-sm border ${
                isActive 
                  ? 'shadow-md scale-105' 
                  : 'hover:bg-gray-50'
              }`
            }
            style={({ isActive }) => ({
              backgroundColor: 'transparent',
              color: isActive ? '#ee81a3' : '#9ca3af',
              borderColor: isActive ? '#ee81a3' : '#e5e7eb'
            })}
          >
            <Users size={28} />
            <span className="text-xs font-bold mt-1">Queue</span>
          </NavLink>
        </div>
      </div>
    </nav>
  );
};
