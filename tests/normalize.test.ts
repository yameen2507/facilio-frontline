import { describe, expect, it } from "vitest";
import {
  dedupKeys,
  domainFromEmail,
  normalizeCompanyName,
  normalizeDomain,
  normalizeEmail,
  normalizePhone,
} from "../src/domain/normalize";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Ahmed@AlManzil.AE ")).toBe("ahmed@almanzil.ae");
  });

  it("rejects anything that is not an address", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("matches the same Gulf number written every way", () => {
    const expected = "501234567";
    expect(normalizePhone("+971 50 123 4567")).toBe(expected);
    expect(normalizePhone("00971501234567")).toBe(expected);
    expect(normalizePhone("0501234567")).toBe(expected);
    expect(normalizePhone("971-50-123-4567")).toBe(expected);
    expect(normalizePhone("(971) 50 123 4567")).toBe(expected);
  });

  it("keeps shorter numbers as-is", () => {
    expect(normalizePhone("04 555 1234")).toBe("045551234");
  });

  it("rejects junk", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("n/a")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("normalizeDomain", () => {
  it("strips scheme, www, port, path and trailing dot", () => {
    expect(normalizeDomain("https://www.AlManzil.ae/contact?x=1")).toBe("almanzil.ae");
    expect(normalizeDomain("http://almanzil.ae:8080")).toBe("almanzil.ae");
    expect(normalizeDomain("almanzil.ae.")).toBe("almanzil.ae");
  });

  it("refuses free email hosts, which are not company identities", () => {
    expect(normalizeDomain("gmail.com")).toBeNull();
    expect(normalizeDomain("https://outlook.com")).toBeNull();
  });

  it("rejects things that are not hosts", () => {
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("two words.com")).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
  });
});

describe("domainFromEmail", () => {
  it("derives a company domain", () => {
    expect(domainFromEmail("ahmed@almanzil.ae")).toBe("almanzil.ae");
  });

  it("returns null for a personal address", () => {
    expect(domainFromEmail("ahmed@gmail.com")).toBeNull();
  });
});

describe("dedupKeys", () => {
  it("produces all three keys", () => {
    expect(
      dedupKeys({
        contactEmail: "Ahmed@AlManzil.ae",
        contactPhone: "+971 50 123 4567",
        websiteDomain: "https://www.almanzil.ae",
      })
    ).toEqual({
      emailNorm: "ahmed@almanzil.ae",
      phoneNorm: "501234567",
      domainNorm: "almanzil.ae",
    });
  });

  it("falls back to the email host when there is no website", () => {
    expect(dedupKeys({ contactEmail: "ahmed@almanzil.ae" }).domainNorm).toBe("almanzil.ae");
  });

  it("leaves the domain null for a gmail lead with no website", () => {
    expect(dedupKeys({ contactEmail: "ahmed@gmail.com" }).domainNorm).toBeNull();
  });

  it("matches two spellings of the same enquiry", () => {
    const a = dedupKeys({ contactEmail: "AHMED@almanzil.ae", contactPhone: "0501234567" });
    const b = dedupKeys({ contactEmail: "ahmed@almanzil.ae ", contactPhone: "+971501234567" });
    expect(a).toEqual(b);
  });
});

describe("normalizeCompanyName", () => {
  it("collapses whitespace and case", () => {
    expect(normalizeCompanyName("  Al   Manzil  Restaurant ")).toBe("al manzil restaurant");
    expect(normalizeCompanyName("")).toBeNull();
  });
});
