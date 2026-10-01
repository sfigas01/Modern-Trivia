import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/use-auth';
import { useAdmin } from '@/hooks/use-admin';

// Sign-in state and the account actions shown on the home screens
// (Sign In / Sign Out, and Admin for admins — STE-239).
export function useAccount() {
  const [, setLocation] = useLocation();
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const { isAdmin } = useAdmin();

  return {
    user,
    isAuthenticated,
    authLoading,
    logout,
    isAdmin: isAuthenticated && isAdmin,
    accountName: user?.email?.split('@')[0],
    goToAdmin: () => setLocation('/admin'),
    signIn: () => {
      window.location.href = '/api/login';
    },
  };
}
