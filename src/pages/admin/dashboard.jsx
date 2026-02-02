import { useEffect, useMemo, useState } from "react";
import AdminSidebar from "../../components/admin/AdminSidebar";
import StatCard from "../../components/admin/StatCard";

import { apiFetch } from "../../config/api";
import { formatDateTimeDDMMYYYY } from "../../utils/dateFormat";
import { formatElapsedMDHM } from "../../utils/durationFormat";
import { Users, Bike, IndianRupee, Clock, TrendingUp, UserCheck, BarChart2, Activity } from "lucide-react";

import { MultiLayerRevenueChart } from "../../components/Charts";
import {
	ResponsiveContainer,
	BarChart,
	CartesianGrid,
	XAxis,
	YAxis,
	Tooltip,
	Bar
} from "recharts";

export default function AdminDashboard() {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");

	const [stats, setStats] = useState([
		{ title: "Total Riders", value: "-", icon: Users, color: "bg-blue-100 text-blue-600" },
		{ title: "Total Rentals", value: "-", icon: Bike, color: "bg-green-100 text-green-600" },
		{ title: "Revenue", value: "-", icon: IndianRupee, color: "bg-yellow-100 text-yellow-600" },
		{ title: "Active Rides", value: "-", icon: Activity, color: "bg-purple-100 text-purple-600" },
	]);

	const [multiLayerData, setMultiLayerData] = useState([]);
	const [rentalsData, setRentalsData] = useState([]);
	const [returnsData, setReturnsData] = useState([]);
	const [rentalsByPackageData, setRentalsByPackageData] = useState([]);
	const [rentalsByZoneData, setRentalsByZoneData] = useState([]);
	const [recentUsers, setRecentUsers] = useState([]);
	const [activeRentals, setActiveRentals] = useState([]);

	const inr = useMemo(
		() => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }),
		[]
	);

	const formatDuration = (startTime) => formatElapsedMDHM(startTime, "-");

	const formatDateTime = (value) => {
		return formatDateTimeDDMMYYYY(value, "-");
	};

	useEffect(() => {
		let mounted = true;

		const load = async () => {
			setLoading(true);
			setError("");
			try {
				const [
					summary,
					recentRiders,
					activeRows,
					analyticsSeries,
					rentalsSeries,
					returnsSeries,
					packageSeries,
					zoneSeries,
				] =
					await Promise.all([
						apiFetch("/api/dashboard/summary"),
						apiFetch("/api/dashboard/recent-riders?limit=3"),
						apiFetch("/api/dashboard/active-rentals?limit=5"),
						apiFetch("/api/dashboard/analytics-months?months=6"),
						apiFetch("/api/dashboard/rentals-week"),
						apiFetch("/api/dashboard/returns-week"),
						apiFetch("/api/dashboard/rentals-by-package?days=30"),
						apiFetch("/api/dashboard/rentals-by-zone?days=30"),
					]);

				if (!mounted) return;

				setStats([
					{ title: "Total Riders", value: inr.format(Number(summary?.totalRiders || 0)), icon: Users, color: "bg-blue-100 text-blue-600" },
					{ title: "Total Rentals", value: inr.format(Number(summary?.totalRentals || 0)), icon: Bike, color: "bg-green-100 text-green-600" },
						{ title: "Revenue", value: `₹${inr.format(Number(summary?.revenue || 0))}`, icon: IndianRupee, color: "bg-yellow-100 text-yellow-600" },
					{ title: "Active Rides", value: inr.format(Number(summary?.activeRides || 0)), icon: Activity, color: "bg-purple-100 text-purple-600" },
				]);

				setMultiLayerData(Array.isArray(analyticsSeries) ? analyticsSeries : []);
				setRentalsData(Array.isArray(rentalsSeries) ? rentalsSeries : []);
				setReturnsData(Array.isArray(returnsSeries) ? returnsSeries : []);
				setRentalsByPackageData(Array.isArray(packageSeries) ? packageSeries : []);
				setRentalsByZoneData(Array.isArray(zoneSeries) ? zoneSeries : []);
				setRecentUsers(
					(Array.isArray(recentRiders) ? recentRiders : []).map((r) => ({
						name: r?.full_name || "-",
						mobile: r?.mobile || "-",
					}))
				);
				setActiveRentals(
					(Array.isArray(activeRows) ? activeRows : []).map((r) => ({
						id: r?.id,
						user: r?.full_name || "-",
						vehicle: r?.vehicle_number || "-",
						duration: formatDuration(r?.start_time),
						startLabel: formatDateTime(r?.start_time),
					}))
				);
			} catch (e) {
				if (!mounted) return;
				setError(String(e?.message || e || "Unable to load dashboard"));
			} finally {
				if (mounted) setLoading(false);
			}
		};

		load();

		const interval = setInterval(load, 15000);
		return () => {
			mounted = false;
			clearInterval(interval);
		};
	}, [inr]);

	return (
		<div className="admin-viewport h-screen flex bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 relative overflow-hidden">

			{/* Background Pattern */}
			<div className="absolute inset-0 opacity-5">
				<div className="absolute top-20 left-20 w-72 h-72 bg-blue-400 rounded-full mix-blend-multiply filter blur-xl animate-pulse"></div>
				<div className="absolute top-40 right-20 w-72 h-72 bg-purple-400 rounded-full mix-blend-multiply filter blur-xl animate-pulse animation-delay-2000"></div>
				<div className="absolute -bottom-8 left-40 w-72 h-72 bg-pink-400 rounded-full mix-blend-multiply filter blur-xl animate-pulse animation-delay-4000"></div>
			</div>

			<AdminSidebar />

			<div className="flex-1 overflow-y-auto relative z-10">
				<div className="p-10 pb-0">
				{/* Hero Header */}
				<div className="mb-6">
					<div className="flex items-center justify-between">
						<div>
							<h1 className="text-4xl font-bold text-slate-900 tracking-tight">
								Dashboard Overview
							</h1>
							<p className="text-lg text-slate-600 mt-2 max-w-2xl">
								Welcome back! Here's what's happening with your eVEGAH operations today.
							</p>
						</div>
						<div className="flex items-center space-x-4">
							<div className="bg-white/80 backdrop-blur-lg rounded-3xl px-8 py-4 shadow-2xl border border-white/30">
								<div className="text-sm text-slate-500 font-medium">Last updated</div>
								<div className="text-2xl font-bold text-slate-800">
									{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
								</div>
							</div>
						</div>
					</div>
				</div>

				{error ? (
					<div className="mb-6 bg-red-50/90 backdrop-blur-lg border border-red-200/50 rounded-3xl p-8 shadow-2xl">
						<div className="flex items-center space-x-4">
							<div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center">
								<span className="text-red-600 text-3xl">⚠️</span>
							</div>
							<div>
								<h3 className="text-2xl font-bold text-red-800">Error Loading Data</h3>
								<p className="text-red-600 text-lg mt-1">{error}</p>
							</div>
						</div>
					</div>
				) : null}

				{/* Stats Grid - Modern Glass Cards */}
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
					{stats.map((item, i) => (
						<div
							key={i}
							className="group relative overflow-hidden bg-white/70 backdrop-blur-xl rounded-2xl p-6 shadow-xl border border-white/30 hover:shadow-2xl hover:scale-102 transition-all duration-300 cursor-pointer"
						>

							{/* Floating geometric shapes */}
							<div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-blue-400/20 to-purple-400/20 rounded-full -translate-y-6 translate-x-6 group-hover:scale-110 transition-transform duration-300"></div>
							<div className="absolute bottom-0 left-0 w-12 h-12 bg-gradient-to-br from-purple-400/20 to-pink-400/20 rounded-xl translate-y-3 -translate-x-3 group-hover:rotate-12 transition-transform duration-300"></div>

							<div className="relative z-10">
								<div className="flex items-center justify-between mb-4">
									<div className={`w-12 h-12 rounded-2xl ${item.color} flex items-center justify-center shadow-lg group-hover:shadow-xl transition-shadow duration-300`}>
										<item.icon className="w-6 h-6" />
									</div>
									<div className="text-2xl opacity-20 group-hover:opacity-60 transition-opacity duration-300 font-bold text-slate-400">
										#{i + 1}
									</div>
								</div>
								<div className="space-y-1">
									<div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
										{item.title}
									</div>
									<div className="text-2xl font-black text-slate-800 group-hover:text-indigo-600 transition-colors duration-300">
										{item.value}
									</div>
								</div>
							</div>
						</div>
					))}
				</div>

				{/* Main Content - Creative Layout */}
				<div className="space-y-6">
					{/* Primary Chart Section */}
					<div className="bg-white/80 backdrop-blur-xl rounded-2xl p-6 shadow-xl border border-white/30 hover:shadow-2xl transition-all duration-300">
						<div className="flex items-center justify-between gap-6 mb-6">
							<div className="flex items-center space-x-4">
								<div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
									<BarChart2 className="w-5 h-5 text-white" />
								</div>
								<div>
									<h2 className="text-2xl font-bold text-slate-800">Revenue & Rentals Overview</h2>
									<p className="text-slate-600 text-sm">Track your business performance over time</p>
								</div>
							</div>
							<div className="flex items-center space-x-3">
								<div className="flex space-x-2">
									<div className="w-2 h-2 bg-indigo-500 rounded-full"></div>
									<div className="w-2 h-2 bg-purple-500 rounded-full"></div>
									<div className="w-2 h-2 bg-pink-500 rounded-full"></div>
								</div>
								<button type="button" className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl font-medium hover:from-indigo-600 hover:to-purple-700 transition-all duration-300 shadow-lg hover:shadow-xl text-sm">
									6 months
								</button>
							</div>
						</div>
						<div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-4">
							<MultiLayerRevenueChart data={multiLayerData} />
						</div>
					</div>

					{/* Secondary Charts Row */}
					<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
						{/* Weekly Rentals */}
						<div className="bg-white/80 backdrop-blur-xl rounded-2xl p-6 shadow-xl border border-white/30 hover:shadow-2xl transition-all duration-300 group">
							<div className="flex items-center justify-between gap-4 mb-4">
								<div className="flex items-center space-x-3">
									<div className="w-8 h-8 bg-gradient-to-br from-green-400 to-blue-500 rounded-xl flex items-center justify-center shadow-lg">
										<Bike className="w-4 h-4 text-white" />
									</div>
									<h3 className="text-lg font-bold text-slate-800">Weekly Rentals</h3>
								</div>
								<button type="button" className="text-slate-500 hover:text-slate-700 transition-colors p-2 hover:bg-slate-100 rounded-xl">
									<TrendingUp className="w-4 h-4" />
								</button>
							</div>
							<div className="bg-gradient-to-br from-green-50 to-blue-50 rounded-xl p-3">
								<ResponsiveContainer width="100%" height={200}>
									<BarChart data={rentalsData}>
										<Bar dataKey="rentals" fill="url(#weeklyGradient)" radius={[8, 8, 0, 0]} />
										<CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
										<XAxis dataKey="day" stroke="#64748b" fontSize={10} />
										<YAxis stroke="#64748b" fontSize={10} />
										<Tooltip
											contentStyle={{
												backgroundColor: 'rgba(255, 255, 255, 0.95)',
												border: 'none',
												borderRadius: '12px',
												boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
											}}
										/>
										<defs>
											<linearGradient id="weeklyGradient" x1="0" y1="0" x2="0" y2="1">
												<stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
												<stop offset="95%" stopColor="#3b82f6" stopOpacity={0.8}/>
											</linearGradient>
										</defs>
									</BarChart>
								</ResponsiveContainer>
							</div>
						</div>

						{/* Recent Riders */}
						<div className="bg-white/80 backdrop-blur-xl rounded-2xl p-6 shadow-xl border border-white/30 hover:shadow-2xl transition-all duration-300">
							<div className="flex items-center justify-between gap-4 mb-4">
								<div className="flex items-center space-x-3">
									<div className="w-8 h-8 bg-gradient-to-br from-purple-400 to-pink-500 rounded-xl flex items-center justify-center shadow-lg">
										<Users className="w-4 h-4 text-white" />
									</div>
									<h3 className="text-lg font-bold text-slate-800">Recent Riders</h3>
								</div>
								<span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full">Live</span>
							</div>
							<div className="space-y-3">
								{recentUsers.slice(0, 4).map((u, i) => (
									<div key={i} className="flex items-center space-x-3 p-3 bg-gradient-to-r from-slate-50 to-slate-100 rounded-xl hover:from-slate-100 hover:to-slate-200 transition-all duration-300">
										<div className="w-8 h-8 bg-gradient-to-br from-indigo-400 to-purple-500 rounded-full flex items-center justify-center text-white font-bold text-sm">
											{u.name.charAt(0).toUpperCase()}
										</div>
										<div className="flex-1 min-w-0">
											<div className="font-medium text-slate-800 text-sm truncate">{u.name}</div>
											<div className="text-xs text-slate-500">{u.mobile}</div>
										</div>
										<div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
									</div>
								))}
							</div>
						</div>

						{/* Active Rentals */}
						<div className="bg-white/80 backdrop-blur-xl rounded-2xl p-6 shadow-xl border border-white/30 hover:shadow-2xl transition-all duration-300">
							<div className="flex items-center justify-between gap-4 mb-4">
								<div className="flex items-center space-x-3">
									<div className="w-8 h-8 bg-gradient-to-br from-orange-400 to-red-500 rounded-xl flex items-center justify-center shadow-lg">
										<Activity className="w-4 h-4 text-white" />
									</div>
									<h3 className="text-lg font-bold text-slate-800">Active Rentals</h3>
								</div>
								<span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full">Live</span>
							</div>
							<div className="space-y-3">
								{activeRentals.slice(0, 3).map((r, i) => (
									<div key={i} className="p-3 bg-gradient-to-r from-orange-50 to-red-50 rounded-xl border border-orange-100">
										<div className="flex items-center justify-between mb-1">
											<div className="font-medium text-slate-800 text-sm truncate">{r.user}</div>
											<div className="text-xs font-bold text-orange-600 bg-orange-100 px-2 py-1 rounded-full">
												{r.duration}
											</div>
										</div>
										<div className="text-xs text-slate-600 truncate">{r.vehicle}</div>
										{r.startLabel && r.startLabel !== "-" && (
											<div className="text-xs text-slate-500 mt-1">Started {r.startLabel}</div>
										)}
									</div>
								))}
								{loading && activeRentals.length === 0 && (
									<div className="text-center py-6 text-slate-500">
										<div className="animate-spin w-6 h-6 border-4 border-orange-200 border-t-orange-500 rounded-full mx-auto mb-2"></div>
										<div className="text-xs">Loading...</div>
									</div>
								)}
							</div>
						</div>
					</div>

					{/* Bottom Analytics Row */}
					<div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
						{/* Rentals by Package */}
						<div className="bg-white/80 backdrop-blur-xl rounded-3xl p-6 shadow-2xl border border-white/30 hover:shadow-3xl transition-all duration-500">
							<div className="flex items-center justify-between gap-4 mb-4">
								<h3 className="text-xl font-bold text-slate-800">Rentals by Package</h3>
								<span className="text-sm text-slate-500 bg-slate-100 px-3 py-1 rounded-full">30 Days</span>
							</div>
							<div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl p-4">
								<ResponsiveContainer width="100%" height={240}>
									<BarChart data={rentalsByPackageData}>
										<CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
										<XAxis dataKey="package" stroke="#64748b" />
										<YAxis stroke="#64748b" />
										<Tooltip
											contentStyle={{
												backgroundColor: 'rgba(255, 255, 255, 0.95)',
												border: 'none',
												borderRadius: '16px',
												boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
											}}
										/>
										<Bar dataKey="rentals" fill="url(#packageGradient)" radius={[12, 12, 0, 0]} />
										<defs>
											<linearGradient id="packageGradient" x1="0" y1="0" x2="0" y2="1">
												<stop offset="5%" stopColor="#6366f1" stopOpacity={0.8}/>
												<stop offset="95%" stopColor="#a855f7" stopOpacity={0.8}/>
											</linearGradient>
										</defs>
									</BarChart>
								</ResponsiveContainer>
							</div>
						</div>

						{/* Returns This Week */}
						<div className="bg-white/80 backdrop-blur-xl rounded-3xl p-6 shadow-2xl border border-white/30 hover:shadow-3xl transition-all duration-500">
							<div className="flex items-center justify-between gap-4 mb-4">
								<h3 className="text-xl font-bold text-slate-800">Returns This Week</h3>
								<span className="text-sm text-slate-500 bg-slate-100 px-3 py-1 rounded-full">Trend</span>
							</div>
							<div className="bg-gradient-to-br from-pink-50 to-rose-50 rounded-2xl p-4">
								<ResponsiveContainer width="100%" height={240}>
									<BarChart data={returnsData}>
										<CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
										<XAxis dataKey="day" stroke="#64748b" />
										<YAxis stroke="#64748b" />
										<Tooltip
											contentStyle={{
												backgroundColor: 'rgba(255, 255, 255, 0.95)',
												border: 'none',
												borderRadius: '16px',
												boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
											}}
										/>
										<Bar dataKey="returns" fill="url(#returnsGradient)" radius={[12, 12, 0, 0]} />
										<defs>
											<linearGradient id="returnsGradient" x1="0" y1="0" x2="0" y2="1">
												<stop offset="5%" stopColor="#ec4899" stopOpacity={0.8}/>
												<stop offset="95%" stopColor="#f43f5e" stopOpacity={0.8}/>
											</linearGradient>
										</defs>
									</BarChart>
								</ResponsiveContainer>
							</div>
						</div>

						{/* Rentals by Zone */}
						<div className="bg-white/80 backdrop-blur-xl rounded-3xl p-6 shadow-2xl border border-white/30 hover:shadow-3xl transition-all duration-500">
							<div className="flex items-center justify-between gap-4 mb-4">
								<h3 className="text-xl font-bold text-slate-800">Rentals by Zone</h3>
								<span className="text-sm text-slate-500 bg-slate-100 px-3 py-1 rounded-full">30 Days</span>
							</div>
							<div className="bg-gradient-to-br from-cyan-50 to-blue-50 rounded-2xl p-4">
								<ResponsiveContainer width="100%" height={240}>
									<BarChart data={rentalsByZoneData}>
										<CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
										<XAxis dataKey="zone" stroke="#64748b" />
										<YAxis stroke="#64748b" />
										<Tooltip
											contentStyle={{
												backgroundColor: 'rgba(255, 255, 255, 0.95)',
												border: 'none',
												borderRadius: '16px',
												boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
											}}
										/>
										<Bar dataKey="rentals" fill="url(#zoneGradient)" radius={[12, 12, 0, 0]} />
										<defs>
											<linearGradient id="zoneGradient" x1="0" y1="0" x2="0" y2="1">
												<stop offset="5%" stopColor="#06b6d4" stopOpacity={0.8}/>
												<stop offset="95%" stopColor="#3b82f6" stopOpacity={0.8}/>
											</linearGradient>
										</defs>
									</BarChart>
								</ResponsiveContainer>
							</div>
						</div>
					</div>
				</div>
				</div>
			</div>
		</div>
	);

}
