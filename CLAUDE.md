# CLAUDE.md

## Project

`kobo-loader` — Bun script that fetches YouTube auto-captions, converts to KEPUB, and uploads to Google Drive for Kobo sync.

## Key constraints (see kobo-pipeline-advice.md for details)

- **FAT32 filenames**: strip `< > : " / \ | ? *` and control chars. Em-dashes and ampersands are fine.
- **KEPUB output**: use kepubify for `.kepub.epub` double extension.
- **Upload via rclone**: not Google API. Remote name is `kobo-drive`, destination is `kobocloud/`.
- **File size**: keep EPUBs under 25MB (Drive interstitial blocks larger for KoboCloud).
- **British English** spelling in all output and identifiers.

## Commands

```bash
bun run index.ts          # Full pipeline
RCLONE_PATH=~/bin/rclone KEPUBIFY_PATH=~/bin/kepubify CLAUDE_PATH=~/.claude/local/claude bun run index.ts
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

`state.json` — array of processed YouTube video IDs. Flat playlists don't include upload dates, so we fetch `lookbackDays * 2` videos per channel and filter against state.

## Server

`ubuntu1.local`, Ubuntu 24.04. Deploy via scp. rclone at `~/bin/rclone`, kepubify at `~/bin/kepubify`. Cron runs daily at 6am.
