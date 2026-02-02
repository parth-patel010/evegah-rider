import { useEffect, useMemo, useState } from "react";
import AdminSidebar from "../../components/admin/AdminSidebar";
import { createAuthUser, deleteAuthUser, listAuthUsers, updateAuthUser } from "../../utils/adminUsers";

function Modal({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl border">
        <div className="flex items-center justify-between gap-4 border-b p-5">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" className="text-gray-600 hover:text-gray-900" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export default function AdminUsers() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createForm, setCreateForm] = useState({
    email: "",
    password: "",
    displayName: "",
    role: "employee",
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({
    email: "",
    displayName: "",
    role: "employee",
    disabled: false,
    password: "",
  });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteUserTarget, setDeleteUserTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const data = await listAuthUsers();
      setUsers(Array.isArray(data?.users) ? data.users : []);
    } catch (e) {
      setError(String(e?.message || e || "Unable to load users"));
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    load();
    const interval = setInterval(() => {
      if (!mounted) return;
      load();
    }, 30000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const email = String(u.email || "").toLowerCase();
      const name = String(u.displayName || "").toLowerCase();
      return email.includes(q) || name.includes(q) || String(u.uid || "").includes(q);
    });
  }, [users, search]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreateError("");

    const email = String(createForm.email || "").trim();
    const password = String(createForm.password || "");
    const role = createForm.role || "employee";

    if (!email || !password) {
      setCreateError("Email and password are required.");
      return;
    }

    setCreating(true);
    try {
      await createAuthUser({
        email,
        password,
        displayName: String(createForm.displayName || "").trim() || null,
        role,
      });

      setCreateForm({ email: "", password: "", displayName: "", role: "employee" });
      await load();
    } catch (e2) {
      setCreateError(String(e2?.message || e2 || "Unable to create user"));
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (u) => {
    setEditUser(u);
    setEditForm({
      email: u.email || "",
      displayName: u.displayName || "",
      role: u.role || "employee",
      disabled: Boolean(u.disabled),
      password: "",
    });
    setEditError("");
    setEditOpen(true);
  };

  const openDelete = (u) => {
    setDeleteUserTarget(u);
    setDeleteError("");
    setDeleteOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteUserTarget?.uid) return;
    setDeleteError("");
    setDeleting(true);
    try {
      await deleteAuthUser(deleteUserTarget.uid);
      setDeleteOpen(false);
      setDeleteUserTarget(null);
      await load();
    } catch (e) {
      setDeleteError(String(e?.message || e || "Unable to delete user"));
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editUser?.uid) return;
    setEditError("");

    setEditSaving(true);
    try {
      await updateAuthUser(editUser.uid, {
        email: String(editForm.email || "").trim() || undefined,
        displayName: String(editForm.displayName || "").trim() || undefined,
        role: editForm.role || undefined,
        disabled: Boolean(editForm.disabled),
        password: editForm.password ? String(editForm.password) : undefined,
      });
      setEditOpen(false);
      setEditUser(null);
      await load();
    } catch (e) {
      setEditError(String(e?.message || e || "Unable to update user"));
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div className="admin-viewport flex bg-gray-100 min-h-screen">
      <AdminSidebar />

      <main className="flex-1 p-10 pb-0 space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold">Users</h1>
          <button type="button" className="px-4 py-2 rounded-xl border bg-white" onClick={load}>
            Refresh
          </button>
        </div>

        {error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        ) : null}

        <div className="bg-white p-6 rounded-2xl shadow-md space-y-4">
          <h2 className="text-lg font-semibold">Create User</h2>

          <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Email *</label>
              <input
                className="w-full border rounded-xl px-4 py-2"
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Password *</label>
              <input
                className="w-full border rounded-xl px-4 py-2"
                type="password"
                value={createForm.password}
                onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Display Name</label>
              <input
                className="w-full border rounded-xl px-4 py-2"
                value={createForm.displayName}
                onChange={(e) => setCreateForm((p) => ({ ...p, displayName: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Role</label>
              <select
                className="w-full border rounded-xl px-4 py-2"
                value={createForm.role}
                onChange={(e) => setCreateForm((p) => ({ ...p, role: e.target.value }))}
              >
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div className="md:col-span-4 flex items-center justify-end gap-3">
              {createError ? <p className="text-sm text-red-600">{createError}</p> : null}
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-purple-600 text-white disabled:opacity-60"
                disabled={creating}
              >
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </form>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-md space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">Manage Users</h2>
            <input
              className="w-full sm:w-80 border rounded-xl px-4 py-2"
              placeholder="Search by email/name/uid"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-3 font-medium">Email</th>
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="py-2 pr-3 font-medium">Role</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-3 text-gray-500">
                      Loading users...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-3 text-gray-500">
                      No users found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((u) => (
                    <tr key={u.uid} className="border-b last:border-b-0">
                      <td className="py-3 pr-3">{u.email || "-"}</td>
                      <td className="py-3 pr-3">{u.displayName || "-"}</td>
                      <td className="py-3 pr-3">{u.role || "employee"}</td>
                      <td className="py-3 pr-3">
                        {u.disabled ? (
                          <span className="text-red-600">Disabled</span>
                        ) : (
                          <span className="text-green-700">Active</span>
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="px-4 py-2 rounded-xl border hover:bg-gray-50"
                            onClick={() => openEdit(u)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="px-4 py-2 rounded-xl border border-red-200 text-red-700 hover:bg-red-50"
                            onClick={() => openDelete(u)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <Modal
          open={editOpen}
          title={editUser ? `Edit User: ${editUser.email || editUser.uid}` : "Edit User"}
          onClose={() => setEditOpen(false)}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-gray-700">Email</label>
              <input
                className="w-full border rounded-xl px-4 py-2"
                value={editForm.email}
                onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Display Name</label>
              <input
                className="w-full border rounded-xl px-4 py-2"
                value={editForm.displayName}
                onChange={(e) => setEditForm((p) => ({ ...p, displayName: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Role</label>
              <select
                className="w-full border rounded-xl px-4 py-2"
                value={editForm.role}
                onChange={(e) => setEditForm((p) => ({ ...p, role: e.target.value }))}
              >
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Status</label>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(editForm.disabled)}
                  onChange={(e) => setEditForm((p) => ({ ...p, disabled: e.target.checked }))}
                />
                <span className="text-sm text-gray-700">Disable user</span>
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Set New Password (optional)</label>
              <input
                className="w-full border rounded-xl px-4 py-2"
                type="password"
                value={editForm.password}
                onChange={(e) => setEditForm((p) => ({ ...p, password: e.target.value }))}
              />
              <p className="mt-1 text-xs text-gray-500">Leave blank to keep unchanged.</p>
            </div>

            <div className="md:col-span-2 flex items-center justify-end gap-3">
              {editError ? <p className="text-sm text-red-600 mr-auto">{editError}</p> : null}
              <button type="button" className="px-4 py-2 rounded-xl border" onClick={() => setEditOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="px-5 py-2 rounded-xl bg-purple-600 text-white disabled:opacity-60"
                onClick={handleSaveEdit}
                disabled={editSaving}
              >
                {editSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </Modal>

        <Modal
          open={deleteOpen}
          title={deleteUserTarget ? `Delete User: ${deleteUserTarget.email || deleteUserTarget.uid}` : "Delete User"}
          onClose={() => {
            if (deleting) return;
            setDeleteOpen(false);
          }}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              This will permanently delete the user from Firebase Authentication.
            </p>

            {deleteError ? (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                {deleteError}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                className="px-4 py-2 rounded-xl border"
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-5 py-2 rounded-xl bg-red-600 text-white disabled:opacity-60"
                onClick={handleConfirmDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </Modal>
      </main>
    </div>
  );
}
