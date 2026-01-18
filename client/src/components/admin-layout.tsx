import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { LayoutDashboard, MessageSquareWarning, Settings, PlusCircle, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AdminLayoutProps {
    children: React.ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
    const [location] = useLocation();

    const navItems = [
        { href: "/admin", icon: PlusCircle, label: "Questions" },
        { href: "/admin/disputes", icon: MessageSquareWarning, label: "Disputes" },
        { href: "/admin/settings", icon: Settings, label: "Settings" },
    ];

    return (
        <div className="min-h-screen bg-background flex">
            {/* Sidebar */}
            <div className="w-64 border-r border-white/10 bg-muted/5 p-4 flex flex-col">
                <div className="mb-8 px-4 py-2">
                    <h1 className="text-xl font-bold tracking-tight text-primary">Trivia Admin</h1>
                    <p className="text-xs text-muted-foreground">Control Panel</p>
                </div>

                <nav className="flex-1 space-y-1">
                    {navItems.map((item) => {
                        const isActive = location === item.href;
                        return (
                            <Link key={item.href} href={item.href}>
                                <a className={cn(
                                    "flex items-center gap-3 px-4 py-2 text-sm font-medium rounded-md transition-colors",
                                    isActive
                                        ? "bg-primary/10 text-primary"
                                        : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                                )}>
                                    <item.icon className="w-4 h-4" />
                                    {item.label}
                                </a>
                            </Link>
                        );
                    })}
                </nav>

                <div className="pt-4 border-t border-white/10">
                    <Link href="/">
                        <Button variant="ghost" className="w-full justify-start text-muted-foreground hover:text-foreground">
                            <LogOut className="w-4 h-4 mr-2" />
                            Exit to Game
                        </Button>
                    </Link>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-auto">
                <div className="p-8 max-w-6xl mx-auto">
                    {children}
                </div>
            </div>
        </div>
    );
}
