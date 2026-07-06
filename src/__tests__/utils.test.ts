import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn — class merging", () => {
  it("returns a single class unchanged", () => {
    expect(cn("foo")).toBe("foo");
  });

  it("joins multiple classes", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("ignores falsy values", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });

  it("handles conditional object syntax", () => {
    expect(cn({ active: true, disabled: false })).toBe("active");
  });

  it("merges conflicting Tailwind classes (last wins)", () => {
    const result = cn("p-4", "p-2");
    expect(result).toBe("p-2");
  });

  it("merges bg- utility conflicts", () => {
    expect(cn("bg-red-500", "bg-blue-500")).toBe("bg-blue-500");
  });

  it("handles empty input", () => {
    expect(cn()).toBe("");
  });

  it("handles array input", () => {
    expect(cn(["a", "b"])).toBe("a b");
  });
});
