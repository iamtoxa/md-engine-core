// Генерация TS-кода из FlatBuffers-схем (требуется flatc в PATH)
const schema = "tools/protocol/schema/messages.fbs";
const outDir = "packages/net/src/protocol/generated";

async function hasFlatc(): Promise<boolean> {
  try {
    const p = Bun.spawn(["flatc", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await p.exited;
    const version = (await (p.stdout as any).text());

    console.info(version);

    return !!version;
  } catch {
    return false;
  }
}

async function run() {
  if (!(await hasFlatc())) {
    console.error(
      "[gen] flatc не найден в PATH. Установите FlatBuffers compiler: https://flatbuffers.dev"
    );
    process.exit(1);
  }
  const args = [
    "flatc",
    "--ts",
    "--filename-suffix",
    "_generated",
    "-o",
    outDir,
    schema,
  ];
  const p = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  await p.exited
  const { exitCode } = p;
  const out = await new Response(p.stdout).text();
  const err = await new Response(p.stderr).text();
  if (out.trim()) console.log(out.trim());
  if (!!err) {
    console.error(err);
    process.exit(exitCode ?? 1);
  }
  console.log("[gen] OK:", schema, "->", outDir);
}

run().catch((e) => {
  console.error("[gen] failed:", e);
  process.exit(1);
});
