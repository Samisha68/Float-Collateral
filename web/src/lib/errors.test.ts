import { describe, it, expect } from "vitest";
import { explainError } from "./errors";

describe("explaining an error", () => {
  it("reads Anchor's structured error code", () => {
    expect(explainError({ error: { errorCode: { code: "ObservationWindowNotElapsed" } } }))
      .toMatch(/watched this pool for long enough/);
  });

  it("digs the code out of program logs when there is no structured error", () => {
    expect(explainError({ logs: ["Program log: AnchorError caused by account: loan. Error Code: LoanAlreadyActive. Error Number: 6017."] }))
      .toMatch(/already have an advance open/);
  });

  it("recognises a declined signature, which is not a failure", () => {
    expect(explainError(new Error("User rejected the request.")))
      .toMatch(/declined the signature/);
  });

  it("recognises a devnet rate limit and names the fix", () => {
    expect(explainError(new Error("429 Too Many Requests")))
      .toMatch(/rate-limiting/);
  });

  it("falls back to Anchor's own message rather than inventing one", () => {
    expect(explainError({ error: { errorMessage: "Some unmapped program condition" } }))
      .toBe("Some unmapped program condition");
  });

  it("shows an unrecognised error raw rather than paraphrasing it", () => {
    expect(explainError(new Error("TypeError: x is not a function")))
      .toBe("TypeError: x is not a function");
  });

  it("never returns an empty string", () => {
    expect(explainError(undefined)).toBe("Something went wrong.");
    expect(explainError({})).toBe("Something went wrong.");
  });
});
