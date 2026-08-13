import { describe, expect, it } from "vitest";
import { addMinutes, DEFAULT_SLA, dueDates, isOverdue, minutesUntil, slaSnapshot } from "../src/domain/sla";

const ARRIVED = "2026-08-13T08:00:00.000Z";

describe("addMinutes", () => {
  it("adds and stays ISO UTC", () => {
    expect(addMinutes(ARRIVED, 60)).toBe("2026-08-13T09:00:00.000Z");
    expect(addMinutes(ARRIVED, 1440)).toBe("2026-08-14T08:00:00.000Z");
  });

  it("throws on nonsense rather than producing an invalid date", () => {
    expect(() => addMinutes("not-a-date", 5)).toThrow(/invalid timestamp/);
  });
});

describe("dueDates", () => {
  it("runs every clock from arrival, not from the previous stage", () => {
    expect(dueDates(ARRIVED, DEFAULT_SLA)).toEqual({
      firstResponseDueAt: "2026-08-13T09:00:00.000Z",
      qualificationDueAt: "2026-08-14T08:00:00.000Z",
      assignmentDueAt: "2026-08-15T08:00:00.000Z",
    });
  });

  it("honours custom targets", () => {
    const d = dueDates(ARRIVED, { firstResponseMins: 15, qualificationMins: 30, assignmentMins: 45 });
    expect(d.firstResponseDueAt).toBe("2026-08-13T08:15:00.000Z");
    expect(d.assignmentDueAt).toBe("2026-08-13T08:45:00.000Z");
  });
});

describe("isOverdue", () => {
  const due = "2026-08-13T09:00:00.000Z";

  it("is late once the clock passes", () => {
    expect(isOverdue(due, "2026-08-13T09:00:01.000Z")).toBe(true);
    expect(isOverdue(due, "2026-08-13T08:59:59.000Z")).toBe(false);
  });

  it("is never late once the stage is done, even long after", () => {
    expect(isOverdue(due, "2026-08-20T00:00:00.000Z", "2026-08-13T08:30:00.000Z")).toBe(false);
  });

  it("treats a missing due date as not overdue", () => {
    expect(isOverdue(null, "2026-08-20T00:00:00.000Z")).toBe(false);
  });
});

describe("minutesUntil", () => {
  it("is positive before and negative after", () => {
    expect(minutesUntil("2026-08-13T09:00:00.000Z", ARRIVED)).toBe(60);
    expect(minutesUntil(ARRIVED, "2026-08-13T09:00:00.000Z")).toBe(-60);
  });
});

describe("slaSnapshot", () => {
  const lead = {
    status: "new",
    ...dueDates(ARRIVED),
  };

  it("reports nothing breached and the next clock while in time", () => {
    const snap = slaSnapshot(lead, "2026-08-13T08:30:00.000Z");
    expect(snap.isOverdue).toBe(false);
    expect(snap.breached).toEqual([]);
    expect(snap.nextDue?.stage).toBe("first_response");
    expect(snap.nextDue?.minutesRemaining).toBe(30);
  });

  it("breaches first response after an hour", () => {
    const snap = slaSnapshot(lead, "2026-08-13T10:00:00.000Z");
    expect(snap.isOverdue).toBe(true);
    expect(snap.breached).toEqual(["first_response"]);
    expect(snap.nextDue?.stage).toBe("qualification");
  });

  it("stops counting a stage once it is completed", () => {
    const snap = slaSnapshot(
      { ...lead, firstContactAt: "2026-08-13T08:30:00.000Z" },
      "2026-08-13T10:00:00.000Z"
    );
    expect(snap.breached).toEqual([]);
    expect(snap.isOverdue).toBe(false);
  });

  it("accumulates breaches as clocks pass", () => {
    const snap = slaSnapshot(lead, "2026-08-16T00:00:00.000Z");
    expect(snap.breached).toEqual(["first_response", "qualification", "assignment"]);
    expect(snap.nextDue).toBeNull();
  });

  it("never marks a finished lead late", () => {
    for (const status of ["converted", "closed"]) {
      const snap = slaSnapshot({ ...lead, status }, "2026-09-01T00:00:00.000Z");
      expect(snap.isOverdue).toBe(false);
      expect(snap.breached).toEqual([]);
    }
  });
});
