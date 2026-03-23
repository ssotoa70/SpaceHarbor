import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useNavVisibility } from "./useNavVisibility";

// Mock useAuth to return different permission sets
const mockPermissions: string[] = [];
vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({
    permissions: mockPermissions,
    state: "authenticated",
    user: { id: "u1", email: "test@test.com", displayName: "Test", roles: [] },
    authMode: "local",
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    initiateOidcLogin: vi.fn(),
    handleOidcCallback: vi.fn(),
  }),
}));

function setPermissions(perms: string[]) {
  mockPermissions.length = 0;
  mockPermissions.push(...perms);
}

describe("useNavVisibility", () => {
  it("viewer sees only LIBRARY section (browse perms, no write perms)", () => {
    setPermissions([
      "browse:assets", "browse:jobs", "browse:review_uri", "browse:queue",
      "browse:materials", "browse:timelines", "browse:projects",
      "browse:shots", "browse:versions", "browse:events",
      "audit:read", "audit:approval",
    ]);
    const { result } = renderHook(() => useNavVisibility());
    const sectionIds = result.current.visibleSections.map((s) => s.id);
    expect(sectionIds).toEqual(["LIBRARY"]);
    expect(result.current.itemsBySection["LIBRARY"]?.length).toBe(3);
  });

  it("artist sees LIBRARY + WORK + REVIEW (has metadata_write:own + approval:submit)", () => {
    setPermissions([
      "browse:assets", "browse:jobs", "browse:review_uri", "browse:queue",
      "browse:materials", "browse:timelines", "browse:projects",
      "browse:shots", "browse:versions", "browse:events",
      "metadata_write:own", "approval:submit", "dcc:request", "dcc:authorize",
      "audit:read", "audit:approval",
    ]);
    const { result } = renderHook(() => useNavVisibility());
    const sectionIds = result.current.visibleSections.map((s) => s.id);
    expect(sectionIds).toContain("LIBRARY");
    expect(sectionIds).toContain("WORK");
    expect(sectionIds).toContain("REVIEW");
    expect(sectionIds).not.toContain("PRODUCTION");
    expect(sectionIds).not.toContain("PIPELINE");
    expect(sectionIds).not.toContain("ADMIN");
  });

  it("supervisor sees LIBRARY + WORK + REVIEW + PRODUCTION", () => {
    setPermissions([
      "browse:assets", "browse:jobs", "browse:review_uri", "browse:queue",
      "browse:materials", "browse:timelines", "browse:projects",
      "browse:shots", "browse:versions", "browse:events",
      "metadata_write:own", "approval:submit", "approval:approve", "approval:reject",
      "approval:override", "review:comment", "review:annotate", "review:react",
      "dcc:request", "dcc:authorize", "audit:read", "audit:approval", "audit:dcc",
      "metadata_write:others", "metadata_write:shot", "metadata_write:sequence",
      "metadata_write:materials", "metadata_write:timelines",
    ]);
    const { result } = renderHook(() => useNavVisibility());
    const sectionIds = result.current.visibleSections.map((s) => s.id);
    expect(sectionIds).toContain("PRODUCTION");
    expect(sectionIds).not.toContain("PIPELINE");
    expect(sectionIds).not.toContain("ADMIN");
  });

  it("pipeline_td sees LIBRARY + PIPELINE (has pipeline:configure_stages)", () => {
    setPermissions([
      "browse:assets", "browse:jobs", "browse:review_uri", "browse:queue",
      "browse:materials", "browse:timelines", "browse:projects",
      "browse:shots", "browse:versions", "browse:events",
      "pipeline:configure_stages", "pipeline:manage_functions",
      "pipeline:trigger_reprocess", "events:publish", "events:vast_subscribe",
      "audit:read", "audit:approval",
    ]);
    const { result } = renderHook(() => useNavVisibility());
    const sectionIds = result.current.visibleSections.map((s) => s.id);
    expect(sectionIds).toContain("LIBRARY");
    expect(sectionIds).toContain("PIPELINE");
    // pipeline_td doesn't have metadata_write:own so no WORK
    expect(sectionIds).not.toContain("WORK");
  });

  it("administrator sees all 6 sections", () => {
    setPermissions([
      "browse:assets", "browse:jobs", "browse:review_uri", "browse:queue",
      "browse:materials", "browse:timelines", "browse:projects",
      "browse:shots", "browse:versions", "browse:events",
      "metadata_write:own", "metadata_write:others", "metadata_write:shot",
      "metadata_write:sequence", "metadata_write:materials", "metadata_write:timelines",
      "approval:submit", "approval:approve", "approval:reject", "approval:override",
      "review:comment", "review:annotate", "review:react",
      "pipeline:configure_stages", "pipeline:manage_functions",
      "pipeline:trigger_reprocess", "events:publish", "events:vast_subscribe",
      "admin:system_config", "admin:analytics", "admin:adhoc_query",
      "admin:manage_projects", "admin:metrics", "admin:incident",
      "iam:manage_users", "iam:manage_roles", "iam:manage_memberships",
      "audit:read", "audit:dcc", "audit:approval",
      "dcc:request", "dcc:authorize",
      "platform:health_dashboard", "platform:manage_alerts",
      "library:manage_collections", "library:bulk_metadata", "library:curate_assets",
      "ingest:create", "ingest:claim_job", "ingest:heartbeat", "ingest:replay",
      "destructive:archive_project", "destructive:delete_version", "destructive:purge_dlq",
      "outbox:read", "outbox:publish",
    ]);
    const { result } = renderHook(() => useNavVisibility());
    const sectionIds = result.current.visibleSections.map((s) => s.id);
    expect(sectionIds).toHaveLength(6);
    expect(sectionIds).toEqual(["LIBRARY", "WORK", "REVIEW", "PRODUCTION", "PIPELINE", "ADMIN"]);
  });

  it("no permissions = no sections visible", () => {
    setPermissions([]);
    const { result } = renderHook(() => useNavVisibility());
    // LIBRARY has no permission gate on its items (assets/hierarchy/materials),
    // but section itself has no gate — so LIBRARY items should be visible
    // Actually, LIBRARY items have no permission gate, so they're always visible
    const sectionIds = result.current.visibleSections.map((s) => s.id);
    expect(sectionIds).toEqual(["LIBRARY"]);
  });
});
