// import React from 'react';
import { Navbar } from './Navbar';
import { Outlet } from 'react-router-dom';

export const Layout = () => {
  return (
    <div className="min-h-screen bg-gray-50 pt-36"> {/* Padding top for fixed navbar */}
      <Navbar />
      <Outlet />
    </div>
  );
};
