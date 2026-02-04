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
    `group relative flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-300 overflow-visible ${isActive
      ? "active bg-blue-600 text-white shadow-lg border border-white/30"
      : "text-slate-600 hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 hover:text-slate-800 hover:shadow-md hover:border hover:border-blue-200/50"
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
        className={`fixed top-0 left-0 z-40 w-64 shrink-0 bg-white border-r border-slate-200 min-h-screen h-screen px-5 pt-6 flex flex-col overflow-hidden transform transition-all duration-500 shadow-xl ${open ? "translate-x-0" : "-translate-x-full sm:translate-x-0"
          }`}
        style={{ minHeight: "100%", height: "100%" }}
      >

        <div className="relative z-10 mb-8 flex items-center gap-3">
          <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg border border-white/20 shrink-0">
            <img src={logo} alt="Evegah" className="h-8 w-auto filter brightness-0 invert" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold text-slate-900 tracking-tight">
              EV Admin
            </div>
            <div className="text-xs text-slate-500 font-medium">Management Portal</div>
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="sm:hidden w-10 h-10 rounded-xl bg-white/50 backdrop-blur-sm grid place-items-center text-slate-700 hover:bg-white/80 transition-all duration-300 border border-white/30 shrink-0"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="relative z-10 space-y-1 flex-1 min-h-0 overflow-x-hidden overflow-y-auto pr-1 bg-white">
          <div className="mb-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-4 mb-2">Dashboard</h3>
            <NavLink to="/admin/dashboard" className={linkClass} onClick={() => setOpen(false)}>
              <div className="w-9 h-9 shrink-0 bg-gradient-to-br from-blue-500/20 to-indigo-500/20 rounded-lg flex items-center justify-center border border-blue-400/30 group-hover:from-blue-500/30 group-hover:to-indigo-500/30 group-hover:border-blue-400/50 transition-all duration-300 group-[.active]:from-white/25 group-[.active]:to-white/25 group-[.active]:border-white/40">
                <LayoutDashboard size={18} className="size-[18px] text-blue-600 group-hover:text-blue-700 group-[.active]:!text-white transition-colors duration-300" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="block font-semibold">Dashboard</span>
                <span className="block text-xs opacity-75">Overview & KPIs</span>
              </div>
            </NavLink>
          </div>

          <div className="mb-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-4 mb-2">Management</h3>
            <div className="space-y-1">
              <NavLink to="/admin/users" className={linkClass} onClick={() => setOpen(false)}>
                <div className="w-9 h-9 shrink-0 bg-gradient-to-br from-emerald-500/20 to-teal-500/20 rounded-lg flex items-center justify-center border border-emerald-400/30 group-hover:from-emerald-500/30 group-hover:to-teal-500/30 group-hover:border-emerald-400/50 transition-all duration-300 group-[.active]:from-white/25 group-[.active]:to-white/25 group-[.active]:border-white/40">
                  <UserCog size={18} className="text-emerald-600 group-hover:text-emerald-700 group-[.active]:!text-white transition-colors duration-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="block font-semibold">Users</span>
                  <span className="block text-xs opacity-75">User Management</span>
                </div>
              </NavLink>

              <NavLink to="/admin/riders" className={linkClass} onClick={() => setOpen(false)}>
                <div className="w-9 h-9 shrink-0 bg-gradient-to-br from-orange-500/20 to-red-500/20 rounded-lg flex items-center justify-center border border-orange-400/30 group-hover:from-orange-500/30 group-hover:to-red-500/30 group-hover:border-orange-400/50 transition-all duration-300 group-[.active]:from-white/25 group-[.active]:to-white/25 group-[.active]:border-white/40">
                  <Users size={18} className="text-orange-600 group-hover:text-orange-700 group-[.active]:!text-white transition-colors duration-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="block font-semibold">Riders</span>
                  <span className="block text-xs opacity-75">Rider Fleet</span>
                </div>
              </NavLink>

              <NavLink to="/admin/rentals" className={linkClass} onClick={() => setOpen(false)}>
                <div className="w-9 h-9 shrink-0 bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-lg flex items-center justify-center border border-cyan-400/30 group-hover:from-cyan-500/30 group-hover:to-blue-500/30 group-hover:border-cyan-400/50 transition-all duration-300 group-[.active]:from-white/25 group-[.active]:to-white/25 group-[.active]:border-white/40">
                  <Bike size={18} className="text-cyan-600 group-hover:text-cyan-700 group-[.active]:!text-white transition-colors duration-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="block font-semibold">Rentals</span>
                  <span className="block text-xs opacity-75">Active Rentals</span>
                </div>
              </NavLink>

              <NavLink to="/admin/returns" className={linkClass} onClick={() => setOpen(false)}>
                <div className="w-9 h-9 shrink-0 bg-gradient-to-br from-violet-500/20 to-purple-500/20 rounded-lg flex items-center justify-center border border-violet-400/30 group-hover:from-violet-500/30 group-hover:to-purple-500/30 group-hover:border-violet-400/50 transition-all duration-300 group-[.active]:from-white/25 group-[.active]:to-white/25 group-[.active]:border-white/40">
                  <RotateCcw size={18} className="text-violet-600 group-hover:text-violet-700 group-[.active]:!text-white transition-colors duration-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="block font-semibold">Returns</span>
                  <span className="block text-xs opacity-75">Vehicle Returns</span>
                </div>
              </NavLink>

              <NavLink to="/admin/battery-swaps" className={linkClass} onClick={() => setOpen(false)}>
                <div className="w-9 h-9 shrink-0 bg-gradient-to-br from-pink-500/20 to-rose-500/20 rounded-lg flex items-center justify-center border border-pink-400/30 group-hover:from-pink-500/30 group-hover:to-rose-500/30 group-hover:border-pink-400/50 transition-all duration-300 group-[.active]:from-white/25 group-[.active]:to-white/25 group-[.active]:border-white/40">
                  <Repeat size={18} className="text-pink-600 group-hover:text-pink-700 group-[.active]:!text-white transition-colors duration-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="block font-semibold">Battery Swaps</span>
                  <span className="block text-xs opacity-75">Battery Management</span>
                </div>
              </NavLink>
            </div>
          </div>

          <div className="mb-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-4 mb-2">Analytics</h3>
            <NavLink to="/admin/analytics" className={linkClass} onClick={() => setOpen(false)}>
              <div className="w-9 h-9 shrink-0 bg-gradient-to-br from-amber-500/20 to-yellow-500/20 rounded-lg flex items-center justify-center border border-amber-400/30 group-hover:from-amber-500/30 group-hover:to-yellow-500/30 group-hover:border-amber-400/50 transition-all duration-300 group-[.active]:from-white/25 group-[.active]:to-white/25 group-[.active]:border-white/40">
                <BarChart3 size={18} className="text-amber-600 group-hover:text-amber-700 group-[.active]:!text-white transition-colors duration-300" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="block font-semibold">Analytics</span>
                <span className="block text-xs opacity-75">Reports & Insights</span>
              </div>
            </NavLink>
          </div>
        </nav>

        <div className="relative z-10 pt-3 pb-4 shrink-0">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-400 hover:bg-gradient-to-r hover:from-red-500/10 hover:to-red-500/5 hover:text-red-500 hover:backdrop-blur-sm transition-all duration-300 font-semibold border border-red-500/20 hover:border-red-400/40 group"
          >
            <div className="w-9 h-9 shrink-0 bg-gradient-to-br from-red-500/20 to-red-600/20 rounded-lg flex items-center justify-center border border-red-400/30 group-hover:shadow-lg transition-all duration-300">
              <LogOut size={18} className="text-red-500" />
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
