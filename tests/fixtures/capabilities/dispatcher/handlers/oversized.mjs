export async function run() {
  return {
    ok: true,
    state: "FIXTURE_OK",
    payload: "x".repeat(2_000),
  };
}
