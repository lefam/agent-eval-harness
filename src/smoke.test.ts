import { expect, it } from "vitest";
import { runSmoke } from "./smoke";
import { canvasFixture } from "../examples/fixtures";

it("detects a running program that actually draws", async () => {
  const r = await runSmoke(canvasFixture(true));
  expect(r.passed, r.errors.join("; ")).toBe(true);
  expect(r.drawCalls).toBeGreaterThan(0);
});
it("rejects a blank canvas even though the program compiles and schedules frames", async () => {
  const r = await runSmoke(canvasFixture(false));
  expect(r.loopStarted).toBe(true); expect(r.passed).toBe(false);
});
it("preserves compilation errors", async () => {
  const r = await runSmoke({ "main.ts": 'import "./missing";' });
  expect(r.passed).toBe(false); expect(r.errors.join(" ")).toContain("bundle:");
});
it("preserves runtime failures", async () => {
  const r = await runSmoke({ "main.ts": 'throw new Error("fixture exploded");' });
  expect(r.passed).toBe(false); expect(r.errors.join(" ")).toContain("fixture exploded");
});
