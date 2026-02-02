import { LineChart, Line, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from "recharts";

export default function MultiLayerRevenueChart({ data }) {
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center text-gray-400">
        No data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="month" />
        <YAxis yAxisId="left" orientation="left" />
        <YAxis yAxisId="right" orientation="right" hide />
        <Tooltip
          formatter={(value, name) => {
            if (name === "revenue") return [value, "Revenue"];
            if (name === "rentals") return [value, "Rentals"];
            if (name === "deposit") return [value, "Deposit"];
            if (name === "cash") return [value, "Cash"];
            if (name === "upi") return [value, "UPI"];
            return [value, name];
          }}
          content={({ active, payload, label }) => {
            if (!active || !payload || !payload.length) return null;
            const d = payload[0].payload;
            return (
              <div className="bg-white border border-gray-200 rounded-lg p-3 shadow text-xs">
                <div className="font-semibold mb-1">{label}</div>
                <div>Revenue: <span className="font-bold">₹{d.revenue}</span></div>
                <div>Rentals: <span className="font-bold">{d.rentals}</span></div>
                <div>Deposit: <span className="font-bold">₹{d.deposit}</span></div>
                <div>Cash: <span className="font-bold">₹{d.cash}</span></div>
                <div>UPI: <span className="font-bold">₹{d.upi}</span></div>
              </div>
            );
          }}
        />
        <Legend />
        <Bar yAxisId="left" dataKey="rentals" fill="#60a5fa" radius={[6, 6, 0, 0]} name="Rentals" />
        <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="#f59e42" strokeWidth={3} dot={false} name="Revenue" />
      </LineChart>
    </ResponsiveContainer>
  );
}
