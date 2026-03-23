import assert from "node:assert/strict";
import test from "node:test";

import { OutboundConfigError, resolveOutboundConfig } from "../src/integrations/outbound/config.js";

test("resolve outbound config includes enabled webhook targets in non-strict mode", () => {
  const config = resolveOutboundConfig({
    SPACEHARBOR_WEBHOOK_SLACK_URL: "https://hooks.example.com/slack",
    SPACEHARBOR_WEBHOOK_PRODUCTION_URL: "https://hooks.example.com/production",
    SPACEHARBOR_WEBHOOK_SIGNING_SECRET: "secret-value"
  });

  assert.equal(config.strictMode, false);
  assert.equal(config.targets.length, 2);
  assert.deepEqual(
    config.targets.map((item) => item.target),
    ["slack", "production"]
  );
  assert.equal(config.signingSecret, "secret-value");
});

test("strict mode requires all target urls and signing secret", () => {
  assert.throws(
    () =>
      resolveOutboundConfig({
        SPACEHARBOR_WEBHOOK_STRICT_MODE: "true",
        SPACEHARBOR_WEBHOOK_SLACK_URL: "https://hooks.example.com/slack",
        SPACEHARBOR_WEBHOOK_TEAMS_URL: "https://hooks.example.com/teams",
        SPACEHARBOR_WEBHOOK_SIGNING_SECRET: "secret-value"
      }),
    (error) => {
      assert.ok(error instanceof OutboundConfigError);
      assert.equal(error.message, "missing required config: SPACEHARBOR_WEBHOOK_PRODUCTION_URL");
      return true;
    }
  );

  assert.throws(
    () =>
      resolveOutboundConfig({
        SPACEHARBOR_WEBHOOK_STRICT_MODE: "true",
        SPACEHARBOR_WEBHOOK_SLACK_URL: "https://hooks.example.com/slack",
        SPACEHARBOR_WEBHOOK_TEAMS_URL: "https://hooks.example.com/teams",
        SPACEHARBOR_WEBHOOK_PRODUCTION_URL: "https://hooks.example.com/production"
      }),
    (error) => {
      assert.ok(error instanceof OutboundConfigError);
      assert.equal(error.message, "missing required config: SPACEHARBOR_WEBHOOK_SIGNING_SECRET");
      return true;
    }
  );
});

test("outbound config validates strict flag and target url format", () => {
  assert.throws(
    () => resolveOutboundConfig({ SPACEHARBOR_WEBHOOK_STRICT_MODE: "enabled" }),
    (error) => {
      assert.ok(error instanceof OutboundConfigError);
      assert.equal(error.message, "invalid SPACEHARBOR_WEBHOOK_STRICT_MODE value (expected true/false)");
      return true;
    }
  );

  assert.throws(
    () =>
      resolveOutboundConfig({
        SPACEHARBOR_WEBHOOK_SLACK_URL: "http://hooks.example.com/slack",
        SPACEHARBOR_WEBHOOK_SIGNING_SECRET: "secret-value"
      }),
    (error) => {
      assert.ok(error instanceof OutboundConfigError);
      assert.equal(error.message, "invalid slack webhook url protocol");
      return true;
    }
  );

  assert.throws(
    () =>
      resolveOutboundConfig({
        SPACEHARBOR_WEBHOOK_SLACK_URL: "not-a-url",
        SPACEHARBOR_WEBHOOK_SIGNING_SECRET: "secret-value"
      }),
    (error) => {
      assert.ok(error instanceof OutboundConfigError);
      assert.equal(error.message, "invalid slack webhook url");
      return true;
    }
  );
});
