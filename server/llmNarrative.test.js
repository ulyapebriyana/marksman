import { describe, it, expect } from "vitest";
import { synthesizeSocialSections, DEFAULT_MODEL } from "./llmNarrative.mjs";

const report = { chain: "robinhood", identity: { name: "T", symbol: "T", address: "0xa", websites: [], twitterUrl: null } };

describe("synthesizeSocialSections — short-circuits before ever calling the API", () => {
  it("returns null with no api key", async () => {
    const social = { configured: true, mentions: [{ text: "hi" }] };
    expect(await synthesizeSocialSections({ report, social, apiKey: "" })).toBeNull();
  });

  it("returns null when the social layer is unconfigured", async () => {
    expect(await synthesizeSocialSections({ report, social: { configured: false }, apiKey: "sk-test" })).toBeNull();
  });

  it("returns null when there is nothing to summarise", async () => {
    const social = { configured: true, mentions: [] };
    expect(await synthesizeSocialSections({ report, social, apiKey: "sk-test" })).toBeNull();
  });

  it("defaults to the current flagship model", () => {
    expect(DEFAULT_MODEL).toBe("claude-opus-5");
  });
});
