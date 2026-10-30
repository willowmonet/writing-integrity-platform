import React from "react";
import { useNavigate } from "react-router-dom";
import { PenLine, LogOut, Inbox } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export default function TopBar({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const initials = (user?.name || user?.email || "?").slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-40 h-16 border-b border-border bg-card/80 backdrop-blur-xl flex items-center px-5 sm:px-8 gap-4">
      <button
        data-testid="home-logo-btn"
        onClick={() => navigate("/")}
        className="flex items-center gap-2 font-display font-bold tracking-tight text-primary text-lg"
      >
        <PenLine className="h-5 w-5" /> Academic Integrity
      </button>
      <div className="flex-1 flex items-center justify-center">{children}</div>
      {user?.role === "student" && (
        <Button variant="ghost" size="sm" data-testid="nav-inbox-btn" onClick={() => navigate("/inbox")} className="gap-2">
          <Inbox className="h-4 w-4" /> Inbox
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button data-testid="user-menu-btn" className="rounded-full ring-2 ring-transparent hover:ring-primary/20 transition-[box-shadow]">
            <Avatar className="h-9 w-9">
              <AvatarImage src={user?.picture} />
              <AvatarFallback className="bg-primary text-primary-foreground text-xs">{initials}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="font-medium truncate">{user?.name}</div>
            <div className="text-xs text-muted-foreground truncate font-normal">{user?.email}</div>
            <div className="text-xs mt-1 capitalize text-primary font-semibold">{user?.role}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem data-testid="logout-btn" onClick={logout} className="text-destructive">
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
