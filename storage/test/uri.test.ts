import { describe, it, expect } from "vitest";
import { parseURI, toGatewayUrl, isStorageUri } from "../src/uri.js";

describe("uri.parseURI", () => {
  it("parses ipfs URI", () => {
    expect(parseURI("ipfs://bafy123")).toEqual({ scheme: "ipfs", id: "bafy123" });
  });

  it("parses ar URI", () => {
    expect(parseURI("ar://abcdef")).toEqual({ scheme: "ar", id: "abcdef" });
  });

  it("parses file URI", () => {
    const r = parseURI("file:///tmp/x.bin");
    expect(r.scheme).toBe("file");
    expect(r.id).toBe("/tmp/x.bin");
  });

  it("parses https URI", () => {
    const r = parseURI("https://example.com/x");
    expect(r.scheme).toBe("https");
    expect(r.id).toBe("example.com/x");
  });

  it("throws on missing scheme", () => {
    expect(() => parseURI("not-a-uri")).toThrow();
  });

  it("throws on unsupported scheme", () => {
    expect(() => parseURI("magnet://abc")).toThrow();
  });

  it("throws on empty body", () => {
    expect(() => parseURI("ipfs://")).toThrow();
  });
});

describe("uri.toGatewayUrl", () => {
  it("rewrites ipfs:// to default gateway", () => {
    const url = toGatewayUrl("ipfs://bafy123", {
      ipfsGateway: "https://gw/ipfs/",
    });
    expect(url).toBe("https://gw/ipfs/bafy123");
  });

  it("appends trailing slash to gateway if missing", () => {
    const url = toGatewayUrl("ipfs://bafy", { ipfsGateway: "https://gw/ipfs" });
    expect(url).toBe("https://gw/ipfs/bafy");
  });

  it("rewrites ar:// to arweave gateway", () => {
    const url = toGatewayUrl("ar://txid42", {
      arweaveGateway: "https://arweave.net/",
    });
    expect(url).toBe("https://arweave.net/txid42");
  });

  it("returns https URIs unchanged", () => {
    expect(toGatewayUrl("https://example.com/x")).toBe("https://example.com/x");
  });

  it("returns file URIs unchanged", () => {
    expect(toGatewayUrl("file:///tmp/x.bin")).toBe("file:///tmp/x.bin");
  });
});

describe("uri.isStorageUri", () => {
  it("returns true for known schemes", () => {
    expect(isStorageUri("ipfs://abc")).toBe(true);
    expect(isStorageUri("ar://abc")).toBe(true);
    expect(isStorageUri("file:///x")).toBe(true);
    expect(isStorageUri("https://x.com")).toBe(true);
  });

  it("returns false for unknown / non-strings", () => {
    expect(isStorageUri("magnet://abc")).toBe(false);
    expect(isStorageUri("plain string")).toBe(false);
    expect(isStorageUri("")).toBe(false);
    expect(isStorageUri(undefined)).toBe(false);
    expect(isStorageUri(42)).toBe(false);
  });
});
