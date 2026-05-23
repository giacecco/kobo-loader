# kobo-loader

Fetches YouTube auto-captions, converts them to KEPUB, and uploads to Google Drive for Kobo sync.

## How it works

1. Fetches recent videos from configured YouTube channels via yt-dlp
2. Downloads auto-generated English captions (SRT format)
3. Parses and formats the transcript into readable prose
4. Generates a Kobo-optimised EPUB
5. Converts to KEPUB via kepubify for native Kobo features
6. Uploads to a Google Drive folder via rclone
7. Tracks processed videos in `state.json` to avoid duplicates

## Setup

### Prerequisites

- [Bun](https://bun.sh)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [rclone](https://rclone.org) — configured with a Google Drive remote named `kobo-drive`
- [kepubify](https://pgaskin.net/kepubify/) — optional, falls back to plain EPUB

### Configuration

Edit `config.json`:

```json
{
  "channels": [
    "https://www.youtube.com/@ExampleChannel"
  ],
  "googleDriveFolderId": "...",
  "lookbackDays": 7,
  "credentialsPath": "./credentials/oauth2.json"
}
```

- `channels` — YouTube channel URLs or @handles
- `lookbackDays` — how many days back to check (fetches 2x this many videos to cover multi-post days)
- `credentialsPath` — not used with rclone, kept for compatibility

### rclone setup

```bash
rclone config   # create a remote called "kobo-drive" of type "drive"
```

The script writes to `kobo-drive:kobocloud/`.

### Cron

```
0 6 * * * cd /path/to/kobo-loader && RCLONE_PATH=/home/user/bin/rclone KEPUBIFY_PATH=/home/user/bin/kepubify /usr/local/bin/bun run index.ts >> /var/log/kobo-loader.log 2>&1
```

## Deduplication

Processed video IDs are stored in `state.json`. Only new videos are processed each run. To reprocess everything, delete the file or set it to `[]`.
