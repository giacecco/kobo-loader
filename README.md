# kobo-loader

Fetches YouTube auto-captions, uses Claude to rewrite them as readable prose, converts them to EPUB ebooks optimised for the Kobo, and uploads them to Google Drive for automated sync with your Kobo eReader — whether supported natively or via a tool such as [KoboCloud](https://github.com/fsantini/KoboCloud). Particularly suitable for monologue-heavy channels you'd rather read than watch.

## How it works

1. Fetches recent videos from configured YouTube channels via yt-dlp
2. Downloads auto-generated English captions (SRT format)
3. Rewrites the transcript as polished prose using `claude -p` (Claude Code CLI)
4. Generates a Kobo-optimised EPUB with thumbnail cover and upload date
5. Converts to KEPUB via kepubify for native Kobo reading features
6. Uploads to a Google Drive folder via rclone
7. Tracks processed video IDs in `state.json` to avoid duplicates
8. Deletes Drive files older than `lookbackDays` to keep storage tidy

## Setup

### Prerequisites

- [Bun](https://bun.sh)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [rclone](https://rclone.org) — configured with a Google Drive remote named `kobo-drive`
- [kepubify](https://pgaskin.net/kepubify/) — optional, falls back to plain EPUB
- [Claude Code CLI](https://claude.ai/code) — logged in with an active subscription

### yt-dlp rate limiting

YouTube will block aggressive scrapers. Configure yt-dlp to pace itself by adding the following to `~/.config/yt-dlp/config` on every machine that runs this script:

```
--sleep-requests 5
--min-sleep-interval 30
--max-sleep-interval 90
--retry-sleep fragment:300
--limit-rate 0.1M
```

### Configuration

Copy `config.example.json` to `config.json` and edit:

```json
{
  "channels": [
    "https://www.youtube.com/@ExampleChannel"
  ]
}
```

- `channels` — YouTube channel URLs or @handles

### rclone setup

```bash
rclone config   # create a remote called "kobo-drive" of type "drive"
```

The script writes to `kobo-drive:kobocloud/`.

### Running

```bash
bun run index.ts --last 7
```

`--last N` sets the lookback window in days (default: 7). The script fetches the 2× most recent videos per channel and filters by what's already in `state.json`.

Optional environment variables to override binary paths:

```bash
RCLONE_PATH=~/bin/rclone \
KEPUBIFY_PATH=~/bin/kepubify \
CLAUDE_PATH=~/.local/bin/claude \
bun run index.ts --last 7
```

### Cron example

```
0 4 * * * RCLONE_PATH=/home/user/bin/rclone KEPUBIFY_PATH=/home/user/bin/kepubify CLAUDE_PATH=/home/user/.local/bin/claude /home/user/.bun/bin/bun run /home/user/kobo-loader/index.ts --last 7 >> /home/user/kobo-loader/kobo-loader.log 2>&1
```

## Deduplication

Processed video IDs are stored in `state.json` with a `processedAt` date. Entries older than `--last N` days are pruned on each run, keeping the file bounded. To reprocess everything, delete the file or set it to `[]`.
