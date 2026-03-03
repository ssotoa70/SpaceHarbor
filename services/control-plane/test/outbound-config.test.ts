import test from "node:test";
import assert from "node:assert/strict";

import {
  OutboundConfigError,
  resolveOutboundConfig
} from "../src/integrations/outbound/config";

const BASE_ENV = {
  ASSETHARBOR_WEBHOOK_SLACK_URL: "",
  ASSETHARBOR_WEBHOOK_TEAMS_URL: "",
  ASSETHARBOR_WEBHOOK_PRODUCTION_URL: "",
  ASSETHARBOR_WEBHOOK_SIGNING_SECRET: "",
  ASSETHARBOR_WEBHOOK_STRICT_MODE: ""
};

test("resolveOutboundConfig omits targets without webhook URLs in non-strict mode", () => {
  const config = resolveOutboundConfig({
    ...BASE_ENV,
    ASSETHARBOR_WEBHOOK_SLACK_URL: "https://hooks.slack.test/asset",
    ASSETHARBOR_WEBHOOK_SIGNING_SECRET: "secret-value"
  });

  assert.equal(config.strictMode, false);
  assert.deepEqual(config.targets, [
    {
      kind: "slack",
      url: "https://hooks.slack.test/asset"
    }
  ]);
});

test("resolveOutboundConfig throws deterministic error in strict mode when a target URL is missing", () => {
  assert.throws(
    () =>
      resolveOutboundConfig({
        ...BASE_ENV,
        ASSETHARBOR_WEBHOOK_STRICT_MODE: "true",
        ASSETHARBOR_WEBHOOK_SIGNING_SECRET: "secret-value",
        ASSETHARBOR_WEBHOOK_SLACK_URL: "https://hooks.slack.test/asset",
        ASSETHARBOR_WEBHOOK_TEAMS_URL: "https://hooks.teams.test/asset"
      }),
    (error: unknown) => {
      assert.ok(error instanceof OutboundConfigError);
      assert.equal(
        error.message,
        "Outbound config validation failed: missing ASSETHARBOR_WEBHOOK_PRODUCTION_URL for target production"
      );
      return true;
    }
  );
});

test("resolveOutboundConfig throws deterministic error when signing secret is missing for enabled targets", () => {
  assert.throws(
    () =>
      resolveOutboundConfig({
        ...BASE_ENV,
        ASSETHARBOR_WEBHOOK_TEAMS_URL: "https://hooks.teams.test/asset"
      }),
    (error: unknown) => {
      assert.ok(error instanceof OutboundConfigError);
      assert.equal(
        error.message,
        "Outbound config validation failed: missing ASSETHARBOR_WEBHOOK_SIGNING_SECRET"
      );
      return true;
    }
  );
});
