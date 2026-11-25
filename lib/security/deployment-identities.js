// Source-controlled deployment identities. Environment variables are checked
// against this allowlist; they are never accepted as the sole proof that a
// hosted runtime may reach a database.
export const PRODUCTION_VERCEL_PROJECT = Object.freeze({
  id: "prj_SeESCUVqpuz1yNdfsbZohp1eFGIx",
  gitRef: "main",
});

export const APPROVED_TEST_VERCEL_PROJECTS = Object.freeze([
  Object.freeze({ id: "prj_BSzyfSJjjrCTI0RieWuVxR8qh3el", name: "tochka-opori-test" }),
  Object.freeze({ id: "prj_FoIS93e41JhmwhcmQKmnKwXDQgjv", name: "tochka-opori-anmed-test" }),
  Object.freeze({ id: "prj_E5bcy3n00Mv3szU6ZdHwbIXrPvUL", name: "tochka-opori-kgmu-test" }),
  Object.freeze({ id: "prj_H6uhvcFyZa5VFruMZ23MVUF5Igpv", name: "tochka-opori-pneumo-test" }),
]);

export const APPROVED_TEST_VERCEL_PROJECT_IDS = Object.freeze(
  APPROVED_TEST_VERCEL_PROJECTS.map(({ id }) => id),
);

export function trustedVercelProjectProfile(projectId) {
  if (projectId === PRODUCTION_VERCEL_PROJECT.id) return "live";
  if (APPROVED_TEST_VERCEL_PROJECT_IDS.includes(projectId)) return "test";
  return null;
}
