'use client';

import { useMsal, useIsAuthenticated } from '@azure/msal-react';
import { loginRequest } from '@/lib/authConfig';

export default function LoginButton() {
  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();

  const handleLogin = async () => {
    try {
      await instance.loginPopup(loginRequest);
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  const handleLogout = () => {
    instance.logoutPopup({
      postLogoutRedirectUri: '/',
    });
  };

  if (isAuthenticated) {
    return (
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-600">
          {accounts[0]?.name ?? accounts[0]?.username}
        </span>
        <button
          onClick={handleLogout}
          className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
        >
          Logg ut
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleLogin}
      className="px-6 py-3 text-base font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors shadow-md"
    >
      Logg inn med Microsoft
    </button>
  );
}
