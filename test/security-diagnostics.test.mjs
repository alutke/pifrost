import assert from "node:assert/strict";
import test from "node:test";

import { bifrostCredentialTransportWarnings } from "../security-diagnostics.mjs";

test("doctor transport warning fires only for credentialed non-loopback HTTP", () => {
  assert.equal(
    bifrostCredentialTransportWarnings(
      { url: "http://192.168.1.221:8180/v1", virtualKey: "vk" },
      undefined,
    ).length,
    1,
  );
  assert.equal(
    bifrostCredentialTransportWarnings(
      { url: "http://127.0.0.1:8180/v1", virtualKey: "vk" },
      undefined,
    ).length,
    0,
  );
  assert.equal(
    bifrostCredentialTransportWarnings(
      { url: "http://localhost:8180/v1", virtualKey: "vk" },
      undefined,
    ).length,
    0,
  );
  assert.equal(
    bifrostCredentialTransportWarnings(
      { url: "https://bifrost.example.com/v1", virtualKey: "vk" },
      undefined,
    ).length,
    0,
  );
  assert.equal(
    bifrostCredentialTransportWarnings(
      { url: "http://bifrost.example.com/v1" },
      undefined,
    ).length,
    0,
  );
});

test("management credentials also trigger the non-loopback HTTP doctor warning", () => {
  assert.equal(
    bifrostCredentialTransportWarnings(
      { url: "http://bifrost.internal:8180/v1" },
      { mode: "basic", username: "admin", password: "secret" },
    ).length,
    1,
  );
});
