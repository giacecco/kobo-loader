# Advice for the AI generating these EPUBs

A handoff note. The destination is a Kobo Clara 2E that syncs from a Google Drive folder via [KoboCloud](https://github.com/fsantini/KoboCloud). These are constraints from the receiving side that have actually broken things in practice — not theoretical concerns.

## 1. Filename sanitization is non-negotiable

The Kobo's user partition is **FAT32**. The following characters are forbidden by the filesystem and will cause silent download failures — curl exits with status 23 ("write error") when KoboCloud tries to create the destination file, and the EPUB never lands on the device:

```
< > : " / \ | ? *
```

The recurring culprit has been the pipe (`|`). Filenames following the pattern `Source Name | Author — Title.epub` were generated repeatedly, and every single one failed to sync. The pipe is common in newsletter and podcast titles; assume it will appear and strip it before writing to Drive.

Minimum sanitization step:

```python
import re
import unicodedata

def sanitize_for_kobo(name: str) -> str:
    # Normalize unicode (em-dashes etc. are fine, but normalize for safety)
    name = unicodedata.normalize("NFC", name)
    # Replace FAT32-forbidden characters with a dash
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '-', name)
    # Collapse runs of separators to a single space
    name = re.sub(r'[\s_-]{2,}', ' ', name).strip()
    # FAT32 silently drops trailing dots and spaces
    name = name.rstrip('. ')
    # FAT32 allows 255 chars but long names render badly on the device
    if len(name) > 180:
        stem, _, ext = name.rpartition('.')
        name = stem[:180 - len(ext) - 1] + '.' + ext
    return name
```

The em-dash (`—`) and ampersand (`&`) are **fine** — they survive FAT32 and KoboCloud both. Don't strip them unnecessarily; you'll lose information.

## 2. Decode JSON escapes properly

Recent filenames have arrived containing the literal string `u0026` where an ampersand should be. This is `\u0026` (the JSON escape for `&`) being passed through with the backslash dropped instead of being decoded as a JSON string. If filenames are sourced from a JSON feed or API response, **parse the JSON**, don't string-process it. Equivalent issues will hit any other backslash escape (`\u00e9` for é, etc.) and produce mojibake the user has to clean up by hand.

## 3. Subdirectories: Drive yes, Dropbox no

KoboCloud supports nested folders on Google Drive but not on Dropbox. The current setup is Drive, so subdirectories are fine — but if anyone ever migrates to Dropbox, flatten the structure first or sync will silently stop seeing the files.

## 4. File size

Google Drive injects a "can't scan this file for viruses, download anyway?" HTML interstitial for files larger than roughly 25MB. KoboCloud's scraper does not reliably follow it. EPUBs above that size will get a 200 response containing an HTML form rather than the actual file, and you'll see a "downloaded" file that's actually a broken HTML blob.

Keep EPUBs under 25MB where you can. If you can't, split or compress images before packaging.

## 5. Prefer KEPUB over EPUB

Kobo can open standard EPUBs but reserves several features (accurate progress tracking, faster page turns, dictionary lookup, reading statistics) for its native KEPUB format. The conversion is one binary: [kepubify](https://pgaskin.net/kepubify/) by Patrick Gaskin. Drop it into the pipeline after EPUB generation:

```bash
kepubify --output ./out/ input.epub
# produces input.kepub.epub
```

The `.kepub.epub` double extension is what tells Nickel (the Kobo's reader app) to treat the file as a KEPUB. Keep both parts.

## 6. How to verify your changes worked

After uploading, the user opens the device, waits for the sync to fire, and checks `.add/kobocloud/get.log` over USB. The relevant lines:

- `Status: 0` + `Status code: 200` + filename appearing in the Library listing at the bottom → success.
- `Status: 23` → curl write error, almost always a forbidden character in the filename.
- `Status code: 416` on a second pass → benign, the file was already complete and curl tried to resume.
- Any HTML content in the curl output where binary should be → Drive interstitial, file too large.

## Summary checklist

Before pushing an EPUB to Drive:

- [ ] No `< > : " / \ | ? *` or control characters in the filename
- [ ] No `\u00xx`-style escape artifacts (JSON decoded properly)
- [ ] No trailing dots or spaces
- [ ] Filename under ~180 characters
- [ ] File under 25MB
- [ ] Converted to `.kepub.epub` via kepubify
