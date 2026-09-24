export async function run(input) {
  return {
    ok: true,
    state: "FIXTURE_OK",
    echo: input?.value ?? null,
  };
}
