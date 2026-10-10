import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../../store/authStore';
import BrandMark from '../BrandMark/BrandMark';
import './ProtectedRoute.css';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export default function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user, token } = useAuthStore();
  const location = useLocation();

  // If initial auth token check is in progress
  if (isLoading && !isAuthenticated) {
    return (
      <main className="session-loading" role="status" aria-label="Authenticating session"><BrandMark size={40} /><span>Agentic Converter</span><div className="session-loading-line" /><p>Authenticating session...</p></main>
    );
  }

  const storedToken = localStorage.getItem('token');
  const activeToken = token || storedToken;

  if (!isAuthenticated || !activeToken) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (requireAdmin && user?.role !== 'ADMIN') {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
