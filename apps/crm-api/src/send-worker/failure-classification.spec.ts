import { describe, expect, it } from "vitest";

import { isTransientStatus } from "./failure-classification";

describe("isTransientStatus", () => {
  it("treats 429 (throttle) as transient", () => {
    expect(isTransientStatus(429)).toBe(true);
  });

  it("treats 5xx incl. Render cold-start (502/503/504) as transient", () => {
    expect(isTransientStatus(500)).toBe(true);
    expect(isTransientStatus(502)).toBe(true);
    expect(isTransientStatus(503)).toBe(true);
    expect(isTransientStatus(504)).toBe(true);
  });

  it("treats other 4xx (client errors) as permanent", () => {
    expect(isTransientStatus(400)).toBe(false);
    expect(isTransientStatus(401)).toBe(false);
    expect(isTransientStatus(403)).toBe(false);
    expect(isTransientStatus(404)).toBe(false);
    expect(isTransientStatus(422)).toBe(false);
  });

  it("treats 2xx/3xx as non-transient (not a failure path, but defined)", () => {
    expect(isTransientStatus(200)).toBe(false);
    expect(isTransientStatus(308)).toBe(false);
  });
});
