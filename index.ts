import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmSync, statSync } from "fs";
import { join } from "path";
import { listRecentVideos, downloadCaptions } from "./lib/youtube";
import { parseSrt } from "./lib/parse-srt";
import { rewriteAsProse, generateSummary } from "./lib/prose";
import { generateEpub } from "./lib/epub";
import { uploadToDrive, deleteOldDriveFiles } from "./lib/drive";
import { $ } from "bun";

interface Config {
  channels: string[];
}

interface StateEntry {
  id: string;
  processedAt: string; // YYYY-MM-DD
}

const CONFIG_PATH = join(import.meta.dir, "config.json");
const STATE_PATH = join(import.meta.dir, "state.json");
const TEMP_DIR = join(import.meta.dir, "tmp");

const FAT32_FORBIDDEN = /[<>:"/\\|?*\x00-\x1f]/g;

function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    console.error("config.json not found. Create one from the example.");
    process.exit(1);
  }
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}

function parseLast(defaultDays: number): number {
  const args = Bun.argv.slice(2);
  const idx = args.findIndex(a => a === "--last");
  if (idx !== -1 && args[idx + 1]) {
    const n = parseInt(args[idx + 1], 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return defaultDays;
}

function loadState(): StateEntry[] {
  if (!existsSync(STATE_PATH)) {
    writeFileSync(STATE_PATH, "[]");
    return [];
  }
  try {
    const data = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === "string") {
      // Migrate old format (bare IDs) — mark all with yesterday's date
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const processedAt = yesterday.toISOString().slice(0, 10);
      console.log(`[kobo-loader] Migrating state.json to new format (${data.length} entries → processedAt ${processedAt})`);
      return (data as string[]).map(id => ({ id, processedAt }));
    }
    return data as StateEntry[];
  } catch {
    return [];
  }
}

function saveState(entries: StateEntry[], lookbackDays: number): void {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const pruned = entries.filter(e => e.processedAt >= cutoffStr);
  writeFileSync(STATE_PATH, JSON.stringify(pruned, null, 2));
}

/**
 * Sanitise a string for use as a FAT32 filename on Kobo.
 * Only strips characters forbidden by FAT32. Em-dashes, ampersands,
 * and accented characters are fine.
 */
function sanitiseForKobo(name: string): string {
  return name
    .replace(FAT32_FORBIDDEN, "-")
    .replace(/[\s_-]{2,}/g, " ")
    .trim()
    .replace(/\.+$/, "") // trailing dots silently dropped by FAT32
    .slice(0, 180); // prevent absurdly long filenames
}

async function convertToKepub(epubPath: string): Promise<string | null> {
  const base = epubPath.replace(/\.epub$/, "");
  const expectedOutput = `${base}_converted.kepub.epub`; // kepubify v4 adds _converted suffix
  const kepubify = Bun.env.KEPUBIFY_PATH || "kepubify";

  const result =
    await $`${kepubify} -o ${TEMP_DIR} ${epubPath}`
      .quiet()
      .nothrow();

  if (result.exitCode !== 0 || !existsSync(expectedOutput)) {
    console.warn("kepubify failed, falling back to plain EPUB:", result.stderr.toString());
    return null;
  }

  return expectedOutput;
}

async function main(): Promise<void> {
  console.log(`[kobo-loader] Starting at ${new Date().toISOString()}`);

  const config = loadConfig();
  const lookbackDays = parseLast(7);
  const state = loadState();
  const processed = new Set(state.map(e => e.id));
  const today = new Date().toISOString().slice(0, 10);

  // Flat playlists don't include upload dates, so we fetch a sliding window
  // of recent videos and rely on state.json for deduplication.
  const maxVideos = lookbackDays * 2;

  console.log(
    `[kobo-loader] Channels: ${config.channels.length}, lookback: ${lookbackDays} days, fetching latest ${maxVideos} per channel, already processed: ${processed.size}`,
  );

  // Ensure temp directory
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }

  let totalUploaded = 0;

  for (const channelUrl of config.channels) {
    console.log(`[kobo-loader] Fetching videos from ${channelUrl}...`);
    const videos = await listRecentVideos(channelUrl, maxVideos);

    // yt-dlp returns newest-first; filter preserves that order so we upload
    // in reverse chronological order and the Kobo library reflects it.
    const newVideos = videos.filter((v) => !processed.has(v.id));
    console.log(
      `[kobo-loader] Fetched ${videos.length} videos, ${newVideos.length} new`,
    );

    for (const video of newVideos) {
      console.log(`[kobo-loader] Processing: ${video.title} (${video.id})`);

      // Step 1: Download captions
      const srtPath = await downloadCaptions(video.url, video.id, TEMP_DIR);
      if (!srtPath) {
        console.warn(
          `[kobo-loader] Skipping "${video.title}" — no captions available`,
        );
        continue;
      }

      // Step 2: Parse SRT
      const srtContent = readFileSync(srtPath, "utf-8");
      const rawTranscript = parseSrt(srtContent);

      // Step 3: Rewrite as prose
      let transcript = rawTranscript;
      try {
        transcript = await rewriteAsProse(video.title, video.channel, rawTranscript);
        console.log(`[kobo-loader] Prose rewrite complete for "${video.title}"`);
      } catch (err) {
        console.warn(`[kobo-loader] Prose rewrite failed, using raw transcript: ${err}`);
      }

      // Step 3b: Generate cover summary
      let summary: string | undefined;
      try {
        summary = await generateSummary(video.title, video.channel, transcript);
        console.log(`[kobo-loader] Summary generated for "${video.title}"`);
      } catch (err) {
        console.warn(`[kobo-loader] Summary generation failed, cover will have no summary: ${err}`);
      }

      // Step 4: Generate EPUB
      const epubPath = join(TEMP_DIR, `${video.id}.epub`);
      await generateEpub(video, transcript, epubPath, summary);

      // Step 5: Convert to KEPUB for better Kobo experience
      let uploadPath = epubPath;
      const kepubPath = await convertToKepub(epubPath);
      if (kepubPath) {
        uploadPath = kepubPath;
      }

      // Step 6: Upload to Drive. Only mark as processed on success.
      const MB = 1024 * 1024;
      const { size } = statSync(uploadPath);
      if (size > 25 * MB) {
        console.warn(
          `[kobo-loader] Skipping "${video.title}" — ${(size / MB).toFixed(1)} MB exceeds 25 MB Drive limit`,
        );
        try { unlinkSync(srtPath); } catch { /* ok */ }
        try { unlinkSync(epubPath); } catch { /* ok */ }
        if (kepubPath) try { unlinkSync(kepubPath); } catch { /* ok */ }
        continue;
      }

      const safeChannel = sanitiseForKobo(video.channel);
      const safeTitle = sanitiseForKobo(video.title);
      const ext = kepubPath ? ".kepub.epub" : ".epub";
      const filename = `${safeChannel} — ${safeTitle}${ext}`;
      const uploadResult = await uploadToDrive(uploadPath, filename);

      if (uploadResult) {
        console.log(`[kobo-loader] Uploaded: ${filename}`);
        state.push({ id: video.id, processedAt: today });
        processed.add(video.id);
        totalUploaded++;
      } else {
        console.error(
          `[kobo-loader] Upload failed for "${video.title}" — will retry next run`,
        );
      }

      // Clean up temp files for this video
      try { unlinkSync(srtPath); } catch { /* ok */ }
      try { unlinkSync(epubPath); } catch { /* ok */ }
      if (kepubPath) try { unlinkSync(kepubPath); } catch { /* ok */ }
    }
  }

  // Persist state (always save to ensure pruning runs even if nothing new)
  saveState(state, lookbackDays);
  if (totalUploaded > 0) {
    console.log(`[kobo-loader] Saved ${totalUploaded} new video IDs to state`);
  }

  // Delete Drive files older than lookbackDays
  await deleteOldDriveFiles(lookbackDays);

  // Clean up temp dir
  try { rmSync(TEMP_DIR, { recursive: true, force: true }); } catch { /* ok */ }

  console.log(
    `[kobo-loader] Done. Uploaded ${totalUploaded} new EPUBs.`,
  );
}

main().catch((err) => {
  console.error("[kobo-loader] Fatal error:", err);
  process.exit(1);
});
