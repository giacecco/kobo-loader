import { existsSync } from "fs";
import { $ } from "bun";

export interface VideoMeta {
  id: string;
  title: string;
  url: string;
  channel: string;
  uploadDate?: string; // YYYYMMDD from yt-dlp, absent on some flat playlist entries
}

interface YtDlpEntry {
  id: string;
  title: string;
  webpage_url: string;
  playlist_channel: string;
  upload_date?: string;
}

/**
 * List the N most recent videos from a YouTube channel.
 * Uses yt-dlp --flat-playlist (fast metadata fetch, no download).
 * Flat playlists don't include upload dates, so we fetch a fixed window
 * and rely on state.json deduplication to skip already-processed videos.
 */
export async function listRecentVideos(
  channelUrl: string,
  maxVideos: number,
): Promise<VideoMeta[]> {
  try {
    const output = await $`yt-dlp --flat-playlist --playlist-end ${maxVideos} --dump-json ${channelUrl}`.quiet().nothrow();
    const lines = output.stdout.toString().trim().split("\n").filter(Boolean);

    return lines.map((line) => {
      const entry: YtDlpEntry = JSON.parse(line);
      return {
        id: entry.id,
        title: entry.title,
        url: entry.webpage_url,
        channel: entry.playlist_channel,
        uploadDate: entry.upload_date,
      };
    });
  } catch (err) {
    console.error(`Failed to list videos for ${channelUrl}:`, err);
    return [];
  }
}

/**
 * Download auto-generated English captions for a video.
 * Returns path to the .srt file, or null if no captions available.
 */
export async function downloadCaptions(
  videoUrl: string,
  videoId: string,
  outputDir: string,
): Promise<string | null> {
  try {
    const result = await $`yt-dlp --write-auto-subs --sub-lang en --convert-subs srt --skip-download -o ${`${outputDir}/%(id)s`} ${videoUrl}`.quiet().nothrow();

    if (result.exitCode !== 0) {
      console.error(`yt-dlp failed for ${videoUrl}:`, result.stderr.toString());
      return null;
    }

    const srtPath = `${outputDir}/${videoId}.en.srt`;

    // yt-dlp may have written .en.srt or .srt depending on the source format
    if (existsSync(srtPath)) {
      return srtPath;
    }

    // Fallback: yt-dlp might have converted from .vtt and written .srt without language suffix
    const altPath = `${outputDir}/${videoId}.srt`;
    if (existsSync(altPath)) {
      return altPath;
    }

    console.warn(`No English captions found for ${videoUrl}`);
    return null;
  } catch (err) {
    console.error(`Failed to download captions for ${videoUrl}:`, err);
    return null;
  }
}
