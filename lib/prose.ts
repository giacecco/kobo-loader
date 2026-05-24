import { $ } from "bun";

export async function generateSummary(
  title: string,
  channel: string,
  prose: string,
): Promise<string> {
  const claude = Bun.env.CLAUDE_PATH || "claude";

  const prompt = `Write a 2–3 sentence summary of the following article. Capture the main argument or topic so a reader knows exactly what to expect. Output only the summary — no preamble, no labels.

Article: "${title}" by ${channel}

${prose}`;

  const proc = Bun.spawn([claude, "-p", "--model", "claude-opus-4-7"], {
    stdin: Buffer.from(prompt, "utf-8"),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`claude -p exited ${exitCode}: ${stderr.trim()}`);
  }

  return stdout.trim();
}

export async function rewriteAsProse(
  title: string,
  channel: string,
  transcript: string,
): Promise<string> {
  const claude = Bun.env.CLAUDE_PATH || "claude";

  const prompt = `You are converting a YouTube auto-caption transcript into polished, readable prose for an e-reader.

Video: "${title}" by ${channel}

The transcript was auto-generated from speech — it lacks punctuation, has repeated phrases, and reads as spoken word rather than written text. Rewrite it as clear, well-structured prose:
- Preserve every idea, fact, and argument in the transcript
- Add natural paragraph breaks at topic shifts
- Fix grammar and punctuation for written prose
- Do not add information not present in the transcript
- Output only the prose — no preamble, no metadata, no commentary

Transcript:
${transcript}`;

  const proc = Bun.spawn([claude, "-p", "--model", "claude-opus-4-7"], {
    stdin: Buffer.from(prompt, "utf-8"),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`claude -p exited ${exitCode}: ${stderr.trim()}`);
  }

  return stdout.trim();
}
