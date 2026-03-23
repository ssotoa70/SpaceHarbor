import { useCallback, useEffect, useState } from "react";

import { fetchIamUsers, updateUserRole, updateUserStatus, createIamUser } from "../api";
import type { IamUserData } from "../api";
import { Badge, Button, Card } from "../design-system";
import { PermissionGate } from "../components/PermissionGate";

const AVAILABLE_ROLES = [
  "vendor_external",
  "viewer",
  "artist",
  "ingest_operator",
  "coordinator",
  "supervisor",
  "producer",
  "tenant_admin",
  "admin",
];

function UsersRolesContent() {
  const [users, setUsers] = useState<IamUserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newRole, setNewRole] = useState("viewer");
  const [creating, setCreating] = useState(false);
  const [confirmDisableUser, setConfirmDisableUser] = useState<IamUserData | null>(null);
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);

  useEffect(() => {
    void fetchIamUsers().then((data) => {
      setUsers(data);
      setLoading(false);
    });
  }, []);

  const handleRoleChange = useCallback(async (userId: string, role: string) => {
    await updateUserRole(userId, [role]);
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, roles: [role] } : u)),
    );
  }, []);

  const handleToggleStatus = useCallback(async (user: IamUserData) => {
    if (user.enabled) {
      // Disabling requires confirmation — show dialog, actual call happens on confirm
      setConfirmDisableUser(user);
      return;
    }
    // Re-enabling: no confirmation needed
    setTogglingUserId(user.id);
    try {
      const updated = await updateUserStatus(user.id, "active");
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, enabled: updated.enabled } : u)));
    } finally {
      setTogglingUserId(null);
    }
  }, []);

  const handleConfirmDisable = useCallback(async () => {
    if (!confirmDisableUser) return;
    const userId = confirmDisableUser.id;
    setConfirmDisableUser(null);
    setTogglingUserId(userId);
    try {
      const updated = await updateUserStatus(userId, "disabled");
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, enabled: updated.enabled } : u)));
    } finally {
      setTogglingUserId(null);
    }
  }, [confirmDisableUser]);

  const handleCreateUser = useCallback(async () => {
    if (!newEmail.trim() || !newDisplayName.trim()) return;
    setCreating(true);
    try {
      const user = await createIamUser({
        email: newEmail.trim(),
        displayName: newDisplayName.trim(),
        roles: [newRole],
      });
      setUsers((prev) => [...prev, user]);
      setNewEmail("");
      setNewDisplayName("");
      setNewRole("viewer");
      setShowCreateForm(false);
    } finally {
      setCreating(false);
    }
  }, [newEmail, newDisplayName, newRole]);

  return (
    <section aria-label="Users and roles" className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Users & Roles</h1>
        <Button variant="primary" onClick={() => setShowCreateForm(!showCreateForm)}>
          {showCreateForm ? "Cancel" : "Create User"}
        </Button>
      </div>

      {showCreateForm && (
        <Card className="p-4 mb-4">
          <h2 className="text-sm font-semibold mb-3">Create New User</h2>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <input
              type="email"
              placeholder="Email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="px-3 py-2 bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-sm)] text-sm"
            />
            <input
              type="text"
              placeholder="Display Name"
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              className="px-3 py-2 bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-sm)] text-sm"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="px-3 py-2 bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-sm)] text-sm"
              aria-label="New user role"
            >
              {AVAILABLE_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <Button
            variant="primary"
            onClick={() => void handleCreateUser()}
            disabled={creating || !newEmail.trim() || !newDisplayName.trim()}
          >
            {creating ? "Creating..." : "Create"}
          </Button>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-[var(--color-ah-text-muted)]">Loading users...</p>
      ) : users.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-ah-text-muted)] py-8 text-center">
            No users found.
          </p>
        </Card>
      ) : (
        <div className="grid gap-1">
          <div className="grid grid-cols-[1fr_180px_140px_100px_80px_140px] gap-4 px-4 py-2 text-xs font-medium text-[var(--color-ah-text-muted)] uppercase tracking-wide">
            <span>User</span>
            <span>Email</span>
            <span>Role</span>
            <span>Status</span>
            <span>Toggle</span>
            <span>Last Login</span>
          </div>
          {users.map((user) => (
            <Card key={user.id} className="grid grid-cols-[1fr_180px_140px_100px_80px_140px] gap-4 items-center px-4 py-3">
              <span className="text-sm font-medium truncate">{user.displayName}</span>
              <span className="text-xs text-[var(--color-ah-text-muted)] truncate">{user.email}</span>
              <select
                value={user.roles[0] ?? "viewer"}
                onChange={(e) => void handleRoleChange(user.id, e.target.value)}
                className="px-2 py-1 bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-sm)] text-xs"
                aria-label={`Role for ${user.displayName}`}
              >
                {AVAILABLE_ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <Badge variant={user.enabled ? "success" : "default"}>
                {user.enabled ? "active" : "disabled"}
              </Badge>
              <div>
                <button
                  disabled={togglingUserId === user.id}
                  onClick={() => void handleToggleStatus(user)}
                  aria-label={user.enabled ? `Disable ${user.displayName}` : `Enable ${user.displayName}`}
                  className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: user.enabled ? "var(--color-ah-success)" : "var(--color-ah-border-muted)" }}
                >
                  <span
                    className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
                    style={{ transform: user.enabled ? "translateX(18px)" : "translateX(2px)" }}
                  />
                </button>
              </div>
              <span className="text-xs text-[var(--color-ah-text-muted)]">
                {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : "never"}
              </span>
            </Card>
          ))}
        </div>
      )}

      {/* Disable confirmation dialog */}
      {confirmDisableUser && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="disable-user-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        >
          <Card className="p-6 max-w-sm w-full mx-4 shadow-xl">
            <h2 id="disable-user-dialog-title" className="text-base font-semibold mb-2">
              Disable user?
            </h2>
            <p className="text-sm text-[var(--color-ah-text-muted)] mb-4">
              <strong>{confirmDisableUser.displayName}</strong> ({confirmDisableUser.email}) will lose
              access immediately. You can re-enable them at any time.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmDisableUser(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => void handleConfirmDisable()}>
                Disable
              </Button>
            </div>
          </Card>
        </div>
      )}
    </section>
  );
}

export function UsersRolesPage() {
  return (
    <PermissionGate
      permission="iam:manage_users"
      fallback={
        <section aria-label="Users and roles" className="p-6 max-w-5xl mx-auto">
          <Card>
            <p className="text-sm text-[var(--color-ah-text-muted)] py-8 text-center">
              You do not have permission to manage users.
            </p>
          </Card>
        </section>
      }
    >
      <UsersRolesContent />
    </PermissionGate>
  );
}
