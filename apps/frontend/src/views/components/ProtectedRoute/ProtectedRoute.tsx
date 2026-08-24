import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../../store/authStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export default function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user, token } = useAuthStore();
  const location = useLocation();

  // If initial auth token check is in progress
  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#090d16',
        color: '#818cf8',
        fontFamily: 'monospace',
        fontSize: '14px'
      }}>
        Authenticating session...
      </div>
    );
  }

  const storedToken = localStorage.getItem('token');
  const activeToken = token || storedToken;

  if (!isAuthenticated || !activeToken) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (requireAdmin && user?.role !== 'ADMIN' && user?.role !== 'OWNER') {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
