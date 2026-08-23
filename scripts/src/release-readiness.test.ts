import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const appTypecheck = "pnpm run typecheck:apps";
const apiProductionBuild = "pnpm --filter @workspace/api-server run build";
const dashboardProductionBuild =
  "pnpm --filter @workspace/niat-spi-dashboard run build";

function assertReleaseBuildOrder(releaseCommand: string) {
  const steps = releaseCommand.split("&&").map((step) => step.trim());
  const appTypecheckIndex = steps.indexOf(appTypecheck);
  const apiBuildIndex = steps.indexOf(apiProductionBuild);
  const dashboardBuildIndex = steps.indexOf(dashboardProductionBuild);

  assert.notEqual(
    appTypecheckIndex,
    -1,
    "validate:release must typecheck applications",
  );
  assert.ok(
    apiBuildIndex > appTypecheckIndex,
    "validate:release must run the API production build after application typechecking",
  );
  assert.ok(
    dashboardBuildIndex > appTypecheckIndex,
    "validate:release must run the dashboard production build after application typechecking",
  );
}

async function readPackageJson(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as {
    scripts: Record<string, string>;
  };
}

test("release readiness typechecks applications before both production builds", async () => {
  const [rootPackage, dashboardPackage] = await Promise.all([
    readPackageJson(resolve(workspaceRoot, "package.json")),
    readPackageJson(
      resolve(workspaceRoot, "artifacts/niat-spi-dashboard/package.json"),
    ),
  ]);

  assertReleaseBuildOrder(rootPackage.scripts["validate:release"]);
  assert.match(
    dashboardPackage.scripts.build,
    /^vite build(?:\s|$)/,
    "the dashboard build command must remain a Vite production build",
  );
});

test("release readiness rejects a missing API production build", () => {
  assert.throws(() =>
    assertReleaseBuildOrder(
      `${appTypecheck} && ${dashboardProductionBuild}`,
    ),
  );
});

test("release readiness rejects a missing dashboard production build", () => {
  assert.throws(() =>
    assertReleaseBuildOrder(
      `${appTypecheck} && ${apiProductionBuild}`,
    ),
  );
});

test("release readiness rejects a dashboard build before application typechecking", () => {
  assert.throws(() =>
    assertReleaseBuildOrder(
      `${dashboardProductionBuild} && ${appTypecheck} && ${apiProductionBuild}`,
    ),
  );
});