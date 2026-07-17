import { Link, useLocation } from 'wouter';
import { cn } from '@/lib/utils';
import {
  MessageSquareWarning,
  Settings,
  PlusCircle,
  LogOut,
  FlaskConical,
  Library,
  ScanSearch,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AdminLayoutProps {
  children: React.ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const [location] = useLocation();

  const navItems = [
    { href: '/admin', icon: PlusCircle, label: 'Add Question' },
    { href: '/admin/staging', icon: FlaskConical, label: 'Staging' },
    { href: '/admin/questions', icon: Library, label: 'Review Questions' },
    { href: '/admin/disputes', icon: MessageSquareWarning, label: 'Disputes' },
    { href: '/admin/quality-sweep', icon: ScanSearch, label: 'Quality Sweep' },
    { href: '/admin/settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Sidebar */}
      <div className="w-full shrink-0 border-b border-white/10 bg-muted/5 p-3 md:w-64 md:border-b-0 md:border-r md:p-4 flex flex-col">
        <div className="mb-3 px-2 py-1 md:mb-8 md:px-4 md:py-2">
          <h1 className="text-xl font-bold tracking-tight text-primary">Trivia Admin</h1>
          <p className="text-xs text-muted-foreground">Control Panel</p>
        </div>

        <nav
          className="flex flex-1 gap-1 overflow-x-auto pb-1 md:block md:space-y-1 md:overflow-visible md:pb-0"
          aria-label="Admin sections"
        >
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors md:gap-3 md:px-4',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden pt-4 border-t border-white/10 md:block">
          <Link href="/" className="block">
            <Button
              variant="ghost"
              className="w-full justify-start text-muted-foreground hover:text-foreground"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Exit to Game
            </Button>
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">{children}</div>
      </div>
    </div>
  );
}
