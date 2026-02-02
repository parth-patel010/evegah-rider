import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  UserCog,
  Bike,
  RotateCcw,
  Repeat,
  BarChart3,
  LogOut,
  Menu,
  X,
  Activity,
} from "lucide-react";

import { signOut } from "firebase/auth";

import { auth } from "../../config/firebase";
import { clearAuthSession } from "../../utils/authSession";

import logo from "../../assets/logo.png";

export default function AdminSidebar() {
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 640px)");
    const sync = () => setOpen(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);

  const handleLogout = async () => {
    try {
      clearAuthSession();
      await signOut(auth);
    } catch {
      // ignore
    } finally {
      setOpen(false);
      navigate("/", { replace: true });
    }
  };

  const linkClass = ({ isActive }) =>
    `group relative flex items-center gap-4 px-6 py-4 rounded-2xl text-sm font-semibold transition-all duration-300 overflow-hidden ${
      isActive
        ? "bg-blue-600 text-white shadow-xl transform scale-105 border border-white/20"
        : "text-slate-600 hover:bg-gradient-to-r hover:from-white/60 hover:to-white/40 hover:text-slate-800 hover:shadow-lg hover:scale-102 hover:border hover:border-white/30"
    }`;

  return (
    <>
      {/* Mobile toggle (shows only when sidebar is closed) */}
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="sm:hidden fixed top-6 right-6 z-30 w-14 h-14 rounded-3xl bg-blue-600 backdrop-blur-xl border border-white/30 shadow-2xl grid place-items-center text-white hover:scale-110 transition-all duration-300"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
      ) : null}

      {/* Backdrop for mobile */}
      {open ? (
        <button
          type="button"
          className="sm:hidden fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
          aria-label="Close menu backdrop"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed sm:sticky top-0 left-0 z-40 w-80 shrink-0 bg-gradient-to-b from-white/95 via-white/90 to-white/95 backdrop-blur-2xl border-r border-white/40 h-screen px-8 py-8 flex flex-col overflow-hidden transform transition-all duration-500 shadow-2xl ${
          open ? "translate-x-0" : "-translate-x-full sm:translate-x-0"
        }`}
      >
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-20 left-10 w-32 h-32 bg-blue-400/20 rounded-full blur-2xl"></div>
          <div className="absolute bottom-20 right-10 w-40 h-40 bg-cyan-400/20 rounded-full blur-2xl"></div>
        </div>

        <div className="relative z-10 mb-12 flex items-center gap-4">
          <div className="w-16 h-16 bg-blue-600 rounded-3xl flex items-center justify-center shadow-xl border border-white/20">
            <img src={logo} alt="Evegah" className="h-10 w-auto filter brightness-0 invert" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xl font-bold text-slate-900 tracking-tight">
              EV Admin
            </div>
            <div className="text-sm text-slate-500 font-medium">Management Portal</div>
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="sm:hidden w-12 h-12 rounded-2xl bg-white/50 backdrop-blur-sm grid place-items-center text-slate-700 hover:bg-white/80 transition-all duration-300 border border-white/30"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="relative z-10 space-y-2 flex-1 overflow-hidden pr-2">
          <div className="mb-6">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-6 mb-3">Dashboard</h3>
            <NavLink to="/admin/dashboard" className={linkClass} onClick={() => setOpen(false)}>
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500/20 to-indigo-500/20 rounded-xl flex items-center justify-center border border-blue-400/30">
                <LayoutDashboard size={20} className="text-blue-600" />
              </div>
              <div className="flex-1">
                <span className="block font-semibold">Dashboard</span>
                <span className="block text-xs opacity-75">Overview & KPIs</span>
              </div>
            </NavLink>
          </div>

          <div className="mb-6">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-6 mb-3">Management</h3>
            <div className="space-y-1">
              <NavLink to="/admin/users" className={linkClass} onClick={() => setOpen(false)}>
                <div className="w-10 h-10 bg-gradient-to-br from-emerald-500/20 to-teal-500/20 rounded-xl flex items-center justify-center border border-emerald-400/30">
                  <UserCog size={20} className="text-emerald-600" />
                </div>
                <div className="flex-1">
                  <span className="block font-semibold">Users</span>
                  <span className="block text-xs opacity-75">User Management</span>
                </div>
              </NavLink>

              <NavLink to="/admin/riders" className={linkClass} onClick={() => setOpen(false)}>
                <div className="w-10 h-10 bg-gradient-to-br from-orange-500/20 to-red-500/20 rounded-xl flex items-center justify-center border border-orange-400/30">
                  <Users size={20} className="text-orange-600" />
                </div>
                <div className="flex-1">
                  <span className="block font-semibold">Riders</span>
                  <span className="block text-xs opacity-75">Rider Fleet</span>
                </div>
              </NavLink>

              <NavLink to="/admin/rentals" className={linkClass} onClick={() => setOpen(false)}>
                <div className="w-10 h-10 bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-xl flex items-center justify-center border border-cyan-400/30">
                  <Bike size={20} className="text-cyan-600" />
                </div>
                <div className="flex-1">
                  <span className="block font-semibold">Rentals</span>
                  <span className="block text-xs opacity-75">Active Rentals</span>
                </div>
              </NavLink>

              <NavLink to="/admin/returns" className={linkClass} onClick={() => setOpen(false)}>
                <div className="w-10 h-10 bg-gradient-to-br from-violet-500/20 to-purple-500/20 rounded-xl flex items-center justify-center border border-violet-400/30">
                  <RotateCcw size={20} className="text-violet-600" />
                </div>
                <div className="flex-1">
                  <span className="block font-semibold">Returns</span>
                  <span className="block text-xs opacity-75">Vehicle Returns</span>
                </div>
              </NavLink>

              <NavLink to="/admin/battery-swaps" className={linkClass} onClick={() => setOpen(false)}>
                <div className="w-10 h-10 bg-gradient-to-br from-pink-500/20 to-rose-500/20 rounded-xl flex items-center justify-center border border-pink-400/30">
                  <Repeat size={20} className="text-pink-600" />
                </div>
                <div className="flex-1">
                  <span className="block font-semibold">Battery Swaps</span>
                  <span className="block text-xs opacity-75">Battery Management</span>
                </div>
              </NavLink>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-6 mb-3">Analytics</h3>
            <NavLink to="/admin/analytics" className={linkClass} onClick={() => setOpen(false)}>
              <div className="w-10 h-10 bg-gradient-to-br from-amber-500/20 to-yellow-500/20 rounded-xl flex items-center justify-center border border-amber-400/30">
                <BarChart3 size={20} className="text-amber-600" />
              </div>
              <div className="flex-1">
                <span className="block font-semibold">Analytics</span>
                <span className="block text-xs opacity-75">Reports & Insights</span>
              </div>
            </NavLink>
          </div>
        </nav>

        <div className="relative z-10">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-4 px-6 py-4 rounded-2xl text-red-400 hover:bg-gradient-to-r hover:from-red-500/10 hover:to-red-500/5 hover:text-red-500 hover:backdrop-blur-sm transition-all duration-300 font-semibold border border-red-500/20 hover:border-red-400/40 group"
          >
            <div className="w-10 h-10 bg-gradient-to-br from-red-500/20 to-red-600/20 rounded-xl flex items-center justify-center border border-red-400/30 group-hover:shadow-lg transition-all duration-300">
              <LogOut size={20} className="text-red-500" />
            </div>
            <div className="flex-1 text-left">
              <span className="block font-semibold">Logout</span>
              <span className="block text-xs opacity-75">Sign out of portal</span>
            </div>
          </button>
        </div>
      </aside>
    </>
  );
}
