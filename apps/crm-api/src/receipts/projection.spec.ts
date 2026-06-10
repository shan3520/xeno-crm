/// <reference types="vitest/globals" />
import { projectCommunication, type ProjectionEvent } from "./projection";

const d = (iso: string): Date => new Date(iso);
const ev = (type: string, iso: string): ProjectionEvent =>
  ({ type, occurredAt: d(iso) }) as ProjectionEvent;

describe("projectCommunication", () => {
  it("picks the highest ladder rung present (CLICKED over DELIVERED/OPENED)", () => {
    const p = projectCommunication([
      ev("SENT", "2026-06-01T10:00:00Z"),
      ev("DELIVERED", "2026-06-01T10:01:00Z"),
      ev("OPENED", "2026-06-01T10:02:00Z"),
      ev("READ", "2026-06-01T10:03:00Z"),
      ev("CLICKED", "2026-06-01T10:04:00Z"),
    ]);
    expect(p.status).toBe("CLICKED");
    expect(p.deliveredAt?.toISOString()).toBe("2026-06-01T10:01:00.000Z");
    expect(p.clickedAt?.toISOString()).toBe("2026-06-01T10:04:00.000Z");
  });

  it("a late-arriving DELIVERED after CLICKED does NOT downgrade status", () => {
    // Same set regardless of arrival order — projection is over the SET, not the sequence.
    const clickedFirst = projectCommunication([
      ev("CLICKED", "2026-06-01T10:04:00Z"),
      ev("DELIVERED", "2026-06-01T10:01:00Z"), // arrives later but occurred earlier
    ]);
    expect(clickedFirst.status).toBe("CLICKED");
    expect(clickedFirst.deliveredAt?.toISOString()).toBe("2026-06-01T10:01:00.000Z");
  });

  it("OPENED arriving before DELIVERED still yields the correct final status", () => {
    const p = projectCommunication([
      ev("OPENED", "2026-06-01T10:02:00Z"),
      ev("DELIVERED", "2026-06-01T10:01:00Z"),
      ev("SENT", "2026-06-01T10:00:00Z"),
    ]);
    expect(p.status).toBe("OPENED");
    expect(p.sentAt?.toISOString()).toBe("2026-06-01T10:00:00.000Z");
    expect(p.deliveredAt?.toISOString()).toBe("2026-06-01T10:01:00.000Z");
    expect(p.openedAt?.toISOString()).toBe("2026-06-01T10:02:00.000Z");
  });

  it("FAILED is terminal and dominates any ladder events", () => {
    const p = projectCommunication([
      ev("SENT", "2026-06-01T10:00:00Z"),
      ev("DELIVERED", "2026-06-01T10:01:00Z"),
      ev("FAILED", "2026-06-01T10:05:00Z"),
    ]);
    expect(p.status).toBe("FAILED");
    expect(p.failedAt?.toISOString()).toBe("2026-06-01T10:05:00.000Z");
    expect(p.deliveredAt?.toISOString()).toBe("2026-06-01T10:01:00.000Z");
  });

  it("CONVERTED is a side-flag: it sets convertedAt but never changes status", () => {
    const p = projectCommunication([
      ev("SENT", "2026-06-01T10:00:00Z"),
      ev("DELIVERED", "2026-06-01T10:01:00Z"),
      ev("OPENED", "2026-06-01T10:02:00Z"),
      ev("READ", "2026-06-01T10:03:00Z"),
      ev("CLICKED", "2026-06-01T10:04:00Z"),
      ev("CONVERTED", "2026-06-01T10:06:00Z"),
    ]);
    expect(p.status).toBe("CLICKED");
    expect(p.convertedAt?.toISOString()).toBe("2026-06-01T10:06:00.000Z");
  });

  it("collapses duplicate events to the earliest occurredAt", () => {
    const p = projectCommunication([
      ev("DELIVERED", "2026-06-01T10:05:00Z"),
      ev("DELIVERED", "2026-06-01T10:01:00Z"), // duplicate type, earlier instant
      ev("DELIVERED", "2026-06-01T10:09:00Z"),
    ]);
    expect(p.status).toBe("DELIVERED");
    expect(p.deliveredAt?.toISOString()).toBe("2026-06-01T10:01:00.000Z");
  });

  it("a lone SENT projects to SENT", () => {
    expect(projectCommunication([ev("SENT", "2026-06-01T10:00:00Z")]).status).toBe("SENT");
  });

  it("only-DELIVERED (SENT event not yet arrived) still projects DELIVERED", () => {
    const p = projectCommunication([ev("DELIVERED", "2026-06-01T10:01:00Z")]);
    expect(p.status).toBe("DELIVERED");
    expect(p.sentAt).toBeNull();
  });
});
