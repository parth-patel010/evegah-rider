import { useState } from "react";
import { apiFetch } from "../../config/api";

export default function EditRiderModal({ rider, close, reload }) {
  const [form, setForm] = useState(rider);

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function saveRider() {
    await apiFetch(`/api/riders/${encodeURIComponent(rider.id)}`, {
      method: "PATCH",
      body: {
        full_name: form.full_name,
        mobile: form.mobile,
        aadhaar: form.aadhaar,
        status: form.status,
      },
    });

    reload();
    close();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex justify-center items-center p-6 z-50">
      <div className="bg-white p-6 rounded-xl w-[400px] shadow-lg">
        <h2 className="text-lg font-semibold mb-4">Edit Rider</h2>

        <div className="space-y-3">
          <input
            name="full_name"
            value={form.full_name}
            onChange={handleChange}
            placeholder="Full Name"
            className="w-full border px-3 py-2 rounded"
          />

          <input
            name="mobile"
            value={form.mobile}
            onChange={handleChange}
            placeholder="Mobile"
            className="w-full border px-3 py-2 rounded"
          />

          <input
            name="aadhaar"
            value={form.aadhaar}
            onChange={handleChange}
            placeholder="Aadhaar"
            className="w-full border px-3 py-2 rounded"
          />

          <select
            name="status"
            value={form.status}
            onChange={handleChange}
            className="w-full border px-3 py-2 rounded"
          >
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={close} className="px-4 py-2 bg-gray-200 rounded">
            Cancel
          </button>
          <button
            onClick={saveRider}
            className="px-4 py-2 bg-blue-600 text-white rounded"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
