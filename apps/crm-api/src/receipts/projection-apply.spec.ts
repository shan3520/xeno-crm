/// <reference types="vitest/globals" />
import {
  STATUS_RANK,
  isBehind,
  projectionToCommunicationUpdate,
} from "./projection-apply";
import { projectCommunication, type ProjectionEvent } from "./projection";

const ev = (type: string, iso: string): ProjectionEvent =>
  ({ type, occurredAt: new Date(iso) }) as ProjectionEvent;

describe("STATUS_RANK / isBehind", () => {
  it("ranks the ladder ascending with FAILED terminal-dominant and QUEUED lowest", () => {
    expect(STATUS_RANK.QUEUED).toBeLessThan(STATUS_RANK.SENT);
    expect(STATUS_RANK.SENT).toBeLessThan(STATUS_RANK.DELIVERED);
    expect(STATUS_RANK.DELIVERED).toBeLessThan(STATUS_RANK.OPENED);
    expect(STATUS_RANK.OPENED).toBeLessThan(STATUS_RANK.READ);
    expect(STATUS_RANK.READ).toBeLessThan(STATUS_RANK.CLICKED);
    // FAILED dominates the whole ladder (matches projection.ts).
    expect(STATUS_RANK.FAILED).toBeGreaterThan(STATUS_RANK.CLICKED);
  });

  it("isBehind is true only when the projection OUTRANKS the stored status", () => {
    // The exact regression we heal: stored SENT, events imply DELIVERED.
    expect(isBehind("SENT", "DELIVERED")).toBe(true);
    expect(isBehind("QUEUED", "FAILED")).toBe(true);
    expect(isBehind("DELIVERED", "CLICKED")).toBe(true);
    expect(isBehind("CLICKED", "FAILED")).toBe(true);
  });

  it("isBehind never asks to downgrade or rewrite an equal status", () => {
    expect(isBehind("DELIVERED", "DELIVERED")).toBe(false);
    expect(isBehind("CLICKED", "DELIVERED")).toBe(false); // would be a downgrade
    expect(isBehind("FAILED", "CLICKED")).toBe(false);
  });
});

describe("projectionToCommunicationUpdate", () => {
  it("sets status + present timestamps, omits absent ones (never null-clobbers)", () => {
    const p = projectCommunication([
      ev("SENT", "2026-06-01T10:00:00Z"),
      ev("DELIVERED", "2026-06-01T10:01:00Z"),
    ]);
    const data = projectionToCommunicationUpdate(p);
    expect(data.status).toBe("DELIVERED");
    expect(data.sentAt).toEqual(new Date("2026-06-01T10:00:00Z"));
    expect(data.deliveredAt).toEqual(new Date("2026-06-01T10:01:00Z"));
    expect("openedAt" in data).toBe(false);
    expect("clickedAt" in data).toBe(false);
    expect("failureReason" in data).toBe(false);
  });

  it("applies the supplied failureReason for a FAILED projection, with a default backstop", () => {
    const p = projectCommunication([ev("FAILED", "2026-06-01T10:00:00Z")]);
    expect(projectionToCommunicationUpdate(p, { failureReason: "hard bounce" }).failureReason).toBe(
      "hard bounce",
    );
    expect(projectionToCommunicationUpdate(p).failureReason).toBe(
      "channel reported delivery failure",
    );
  });
});
