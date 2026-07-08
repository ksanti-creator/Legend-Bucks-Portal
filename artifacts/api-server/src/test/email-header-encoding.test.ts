import { describe, it, expect } from "vitest";
import { encodeHeaderValue, encodeFromHeader } from "../lib/email";

/**
 * Guards the MIME encoded-word (RFC 2047) header encoding so a future refactor
 * of the send path can't silently reintroduce garbled subjects (mojibake) for
 * emoji or accented reward/inviter names.
 */
describe("encodeHeaderValue", () => {
  it("passes pure-ASCII values through unchanged", () => {
    expect(encodeHeaderValue("Your Legend Bucks sign-in link")).toBe(
      "Your Legend Bucks sign-in link",
    );
    expect(encodeHeaderValue("")).toBe("");
  });

  it("encodes an emoji subject as a valid UTF-8 base64 encoded-word", () => {
    const subject = "You received 1,250 LB! 🎉";
    const encoded = encodeHeaderValue(subject);

    const match = /^=\?UTF-8\?B\?(.+)\?=$/.exec(encoded);
    expect(match).not.toBeNull();

    // The payload must round-trip back to the original UTF-8 string.
    const decoded = Buffer.from(match![1], "base64").toString("utf-8");
    expect(decoded).toBe(subject);
  });

  it("encodes accented names as a valid UTF-8 base64 encoded-word", () => {
    const subject = "Zoé Müller invited you to Legend Bucks";
    const encoded = encodeHeaderValue(subject);

    const match = /^=\?UTF-8\?B\?(.+)\?=$/.exec(encoded);
    expect(match).not.toBeNull();
    expect(Buffer.from(match![1], "base64").toString("utf-8")).toBe(subject);
  });
});

describe("encodeFromHeader", () => {
  it("leaves an ASCII display name and address untouched", () => {
    expect(encodeFromHeader("Legend Bucks <rewards@legendboats.com>")).toBe(
      "Legend Bucks <rewards@legendboats.com>",
    );
  });

  it("encodes a non-ASCII display name while keeping the <address> intact", () => {
    const encoded = encodeFromHeader("Zoé Müller <rewards@legendboats.com>");

    // Address stays verbatim, ASCII-only.
    expect(encoded.endsWith(" <rewards@legendboats.com>")).toBe(true);

    const namePart = encoded.slice(0, encoded.length - " <rewards@legendboats.com>".length);
    const match = /^=\?UTF-8\?B\?(.+)\?=$/.exec(namePart);
    expect(match).not.toBeNull();
    expect(Buffer.from(match![1], "base64").toString("utf-8")).toBe("Zoé Müller");
  });

  it("encodes a bare non-ASCII address-less value", () => {
    const encoded = encodeFromHeader("Zoé Müller");
    const match = /^=\?UTF-8\?B\?(.+)\?=$/.exec(encoded);
    expect(match).not.toBeNull();
    expect(Buffer.from(match![1], "base64").toString("utf-8")).toBe("Zoé Müller");
  });
});
