"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/context/auth-context";
import { Home, Calendar, MessageSquare, Users, Settings, LogOut, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

const playerNav = [
  { href: "/", label: "Home", icon: Home },
  { href: "/sessions", label: "Sessions", icon: Calendar },
  { href: "/profile", label: "Profile", icon: Users },
];

const adminNav = [
  { href: "/admin", label: "Dashboard", icon: Shield },
  { href: "/admin/sessions", label: "Sessions", icon: Calendar },
  { href: "/admin/messages", label: "Messages", icon: MessageSquare },
  { href: "/admin/players", label: "Players", icon: Users },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export function NavBar() {
  const pathname = usePathname();
  const { player, isAdmin, signOut } = useAuth();

  if (!player) return null;

  const isAdminRoute = pathname.startsWith("/admin");
  const navItems = isAdminRoute ? adminNav : playerNav;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background safe-bottom">
      <nav className="mx-auto flex max-w-lg items-center justify-around px-2 py-1">
        {navItems.map((item) => {
          const isActive = item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-0.5 px-3 py-2 text-xs transition-colors",
                isActive
                  ? "text-green-700 font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
        {isAdmin && (
          <Link
            href={isAdminRoute ? "/" : "/admin"}
            className="flex flex-col items-center gap-0.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            {isAdminRoute ? <Home className="h-5 w-5" /> : <Shield className="h-5 w-5" />}
            {isAdminRoute ? "Player" : "Admin"}
          </Link>
        )}
        <button
          onClick={signOut}
          className="flex flex-col items-center gap-0.5 px-3 py-2 text-xs text-muted-foreground hover:text-destructive"
        >
          <LogOut className="h-5 w-5" />
          Logout
        </button>
      </nav>
    </div>
  );
}
