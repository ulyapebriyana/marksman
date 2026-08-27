import { describe, it, expect } from "vitest";
import { buildSocialQuery, fetchSocialMentions, SOCIAL_PROVIDERS } from "./socialIntel.mjs";

describe("buildSocialQuery", () => {
  it("leads with the cashtag, which is how traders actually refer to a token", () => {
    const q = buildSocialQuery({ symbol: "PONSBOT", address: null, twitterUrl: null });
    expect(q).toBe("($PONSBOT)");
  });

  it("includes the project's own handle both as author and as mention", () => {
    const q = buildSocialQuery({ symbol: "ABC", address: null, twitterUrl: "https://x.com/Ponsbotfamily" });
    expect(q).toContain("(from:Ponsbotfamily)");
    expect(q).toContain("(@Ponsbotfamily)");
  });

  it("accepts a twitter.com handle as well as an x.com one", () => {
    const q = buildSocialQuery({ symbol: null, address: null, twitterUrl: "https://twitter.com/someproject" });
    expect(q).toContain("(from:someproject)");
  });

  // "Here's the CA: 0x…" posts never use the ticker, so the address is the
  // only term that catches them.
  it("includes the contract address as its own term", () => {
    const q = buildSocialQuery({ symbol: "ABC", address: "0xdead", twitterUrl: null });
    expect(q).toContain("(0xdead)");
  });

  it("ORs the terms together", () => {
    const q = buildSocialQuery({ symbol: "ABC", address: "0xdead", twitterUrl: null });
    expect(q).toBe("($ABC) OR (0xdead)");
  });

  it("returns null when there is nothing searchable", () => {
    expect(buildSocialQuery({ symbol: null, address: null, twitterUrl: null })).toBeNull();
  });
});

describe("fetchSocialMentions — unconfigured is a normal state, not an error", () => {
  const query = "($ABC)";

  it("returns null with no provider", async () => {
    expect(await fetchSocialMentions({ provider: null, apiKey: "k", query })).toBeNull();
  });

  it("returns null with no api key", async () => {
    expect(await fetchSocialMentions({ provider: "x", apiKey: "", query })).toBeNull();
  });

  it("returns null with no query", async () => {
    expect(await fetchSocialMentions({ provider: "x", apiKey: "k", query: null })).toBeNull();
  });

  it("returns null for an unknown provider rather than attempting a call", async () => {
    expect(await fetchSocialMentions({ provider: "mastodon", apiKey: "k", query })).toBeNull();
  });

  it("exposes exactly the providers it implements", () => {
    expect(SOCIAL_PROVIDERS).toEqual(["twitterapi", "x"]);
  });
});
