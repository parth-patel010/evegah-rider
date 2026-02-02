export default function StatCard({ icon, title, value }) {
  return (
    <div className="bg-white p-5 rounded-xl shadow flex items-center gap-4">
      <div className="p-3 bg-purple-100 text-purple-600 rounded-lg">
        {icon}
      </div>
      <div>
        <p className="text-sm text-gray-500">{title}</p>
        <p className="text-xl font-semibold">{value}</p>
      </div>
    </div>
  );
}
  