import { apiFetch } from "../../config/api";

export default function DeleteModal({ rider, bulkIds = [], close, reload, onBulkSuccess }) {
  const isBulk = Array.isArray(bulkIds) && bulkIds.length > 0;

  async function deleteRider() {
    if (isBulk) {
      await apiFetch("/api/riders/bulk-delete", {
        method: "POST",
        body: { ids: bulkIds },
      });
    } else if (rider && rider.id) {
      await apiFetch(`/api/riders/${encodeURIComponent(rider.id)}`, {
        method: "DELETE",
      });
    }
    reload();
    if (isBulk && typeof onBulkSuccess === "function") {
      onBulkSuccess();
    }
    close();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex justify-center items-center p-6 z-50">
      <div className="bg-white p-6 rounded-xl w-[380px] shadow-lg text-center">
        <h2 className="text-xl font-semibold mb-4">
          {isBulk ? "Delete Selected Riders?" : "Delete Rider?"}
        </h2>
        <p className="text-gray-600 mb-6">
          {isBulk ? (
            <>
              Are you sure you want to delete the selected <strong>{bulkIds.length}</strong> riders?
            </>
          ) : (
            <>
              Are you sure you want to delete <strong>{rider?.full_name || "this rider"}</strong>?
            </>
          )}
        </p>

        <div className="flex justify-center gap-3">
          <button onClick={close} className="px-4 py-2 bg-gray-200 rounded">
            Cancel
          </button>
          <button
            onClick={deleteRider}
            className="px-4 py-2 bg-red-600 text-white rounded"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
