// import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

// Pages
// Pages
import Home from './pages/Home';
import Admin from './pages/Admin';
import Queue from './pages/Queue';
import Menu from './pages/Menu';
import Login from './pages/Login';
import MainLayout from './components/MainLayout';
import { RequireAuth } from './components/RequireAuth';

function App() {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="app-container">
        <Routes>
          <Route element={<MainLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/menu" element={<Menu />} />
            <Route path="/queue" element={<Queue />} />
            
            {/* Protected Admin Routes - now inside MainLayout for uniform nav */}
            <Route element={<RequireAuth />}>
               <Route path="/admin" element={<Admin />} />
            </Route>
          </Route>

          {/* Login Page */}
          <Route path="/login" element={<Login />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
