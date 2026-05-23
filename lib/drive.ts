import { $ } from "bun";

/**
 * Upload a file to Google Drive via rclone.
 * rclone must be pre-configured with the remote named "kobo-drive".
 */
export async function uploadToDrive(
  localPath: string,
  filename: string,
): Promise<string | null> {
  try {
    const rclone = Bun.env.RCLONE_PATH || "rclone";
    const dest = `kobo-drive:kobocloud/${filename}`;
    const result = await $`${rclone} copyto ${localPath} ${dest} --no-update-modtime`.quiet().nothrow();

    if (result.exitCode !== 0) {
      console.error(`rclone upload failed: ${result.stderr.toString()}`);
      return null;
    }

    return dest;
  } catch (err) {
    console.error(`Failed to upload ${filename} to Drive:`, err);
    return null;
  }
}

export async function deleteOldDriveFiles(olderThanDays: number): Promise<void> {
  try {
    const rclone = Bun.env.RCLONE_PATH || "rclone";
    const minAge = `${olderThanDays}d`;
    const result = await $`${rclone} delete kobo-drive:kobocloud/ --min-age ${minAge}`.quiet().nothrow();
    if (result.exitCode !== 0) {
      console.warn(`[kobo-loader] Drive cleanup failed: ${result.stderr.toString()}`);
    } else {
      console.log(`[kobo-loader] Deleted files older than ${olderThanDays} days from Drive`);
    }
  } catch (err) {
    console.error("[kobo-loader] Drive cleanup error:", err);
  }
}
