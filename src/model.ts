/** Public adapter metadata. Provider selection belongs to the caller. */
export type ModelSpec = { provider: string; model: string };

export function parseModelSpec(value: string): ModelSpec {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1 || /\s/.test(value)) {
    throw new Error("Expected provider/model");
  }
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) };
}
