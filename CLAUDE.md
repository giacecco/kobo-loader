# CLAUDE.md

## Project

`kobo-loader` — Bun script that fetches YouTube auto-captions, rewrites them as prose via `claude -p`, converts to KEPUB, and uploads to Google Drive for Kobo sync.

## Key constraints (see kobo-pipeline-advice.md for details)

- **FAT32 filenames**: strip `< > : " / \ | ? *` and control chars. Em-dashes and ampersands are fine.
- **KEPUB output**: use kepubify for `.kepub.epub` double extension.
- **Upload via rclone**: not Google API. Remote name is `kobo-drive`, destination is `kobocloud/`.
- **File size**: keep EPUBs under 25MB (Drive interstitial blocks larger for KoboCloud).
- **British English** spelling in all output and identifiers.

## Commands

```bash
bun run index.ts --last 7          # Full pipeline (--last N defaults to 7)
RCLONE_PATH=~/bin/rclone KEPUBIFY_PATH=~/bin/kepubify CLAUDE_PATH=~/.local/bin/claude bun run index.ts --last 7
```

## Architecture

```
index.ts          — orchestrator: config, state, pipeline loop
lib/youtube.ts    — yt-dlp wrapper (--flat-playlist, --write-auto-subs)
lib/parse-srt.ts  — SRT → clean paragraph text
lib/prose.ts      — claude -p prose rewriter (falls back to raw transcript on error)
lib/epub.ts       — manual EPUB generation (ZIP + XHTML + OPF + NCX)
lib/drive.ts      — rclone upload wrapper
```

## State

`state.json` — array of `{ id, processedAt }` objects. Entries older than `--last N` days are pruned on each run. Flat playlists don't include upload dates, so we fetch `N * 2` videos per channel and rely on state for deduplication.

## Server

`ubuntu1.local`, Ubuntu 24.04. Deploy via scp. rclone at `~/bin/rclone`, kepubify at `~/bin/kepubify`. Cron runs daily at 4am with `--last 7`.

yt-dlp throttle config at `~/.config/yt-dlp/config` on both local and ubuntu1 — verified to load under cron.
