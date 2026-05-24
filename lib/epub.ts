import { writeFileSync, mkdirSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { $ } from "bun";
import type { VideoMeta } from "./youtube";

async function downloadThumbnail(videoId: string, destPath: string): Promise<boolean> {
  for (const quality of ["maxresdefault", "hqdefault"]) {
    try {
      const res = await fetch(`https://img.youtube.com/vi/${videoId}/${quality}.jpg`);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      writeFileSync(destPath, Buffer.from(buf));
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Generate a Kobo-optimised EPUB from a transcript.
 * Builds the EPUB manually — EPUB is just a ZIP with XML/HTML files inside.
 */
export async function generateEpub(
  video: VideoMeta,
  transcript: string,
  outputPath: string,
  summary?: string,
): Promise<string> {
  const workDir = outputPath + ".d";

  // Clean up any leftover
  if (existsSync(workDir)) {
    rmSync(workDir, { recursive: true });
  }

  const oebpsDir = join(workDir, "OEBPS");
  const metaDir = join(workDir, "META-INF");
  mkdirSync(oebpsDir, { recursive: true });
  mkdirSync(metaDir, { recursive: true });

  const bookId = generateUuid();
  const bodyHtml = transcriptToHtml(transcript);
  const hasCoverImage = await downloadThumbnail(video.id, join(oebpsDir, "cover.jpg"));

  try {
    // mimetype must be first, stored uncompressed
    writeFileSync(join(workDir, "mimetype"), "application/epub+zip");
    writeFileSync(join(metaDir, "container.xml"), containerXml());
    writeFileSync(join(oebpsDir, "content.opf"), contentOpf(video, bookId, hasCoverImage));
    writeFileSync(join(oebpsDir, "toc.ncx"), tocNcx(video, bookId));
    writeFileSync(join(oebpsDir, "cover.xhtml"), coverXhtml(video, hasCoverImage, summary));
    writeFileSync(join(oebpsDir, "chapter1.xhtml"), chapterXhtml(video, bodyHtml));

    // Build EPUB (ZIP with mimetype first, uncompressed)
    const zipResult =
      await $`cd ${workDir} && zip -0X ${outputPath} mimetype && zip -r9X ${outputPath} META-INF OEBPS`
        .quiet()
        .nothrow();

    if (zipResult.exitCode !== 0) {
      throw new Error(`Failed to create EPUB: ${zipResult.stderr.toString()}`);
    }
  } finally {
    rmSync(workDir, { recursive: true });
  }

  return outputPath;
}

function coverXhtml(video: VideoMeta, hasCoverImage: boolean, summary?: string): string {
  const thumbnailHtml = hasCoverImage
    ? `<img src="cover.jpg" alt="${escapeXml(video.title)}" class="thumbnail"/>\n    `
    : "";
  const topMargin = hasCoverImage ? "1.5em" : "3em";
  const summaryHtml = summary
    ? `\n    <div class="summary"><p>${escapeXml(summary)}</p></div>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <title>${escapeXml(video.title)}</title>
  <style>
    body {
      font-family: Georgia, "Times New Roman", serif;
      margin: 0;
      padding: 0.5em;
      color: #1a1a1a;
    }
    .thumbnail {
      width: 75%;
      max-width: 75%;
      height: auto;
      display: block;
      margin: 0 0 1em;
    }
    .title-page {
      text-align: left;
      margin: ${topMargin} 0 2.5em;
    }
    .title-page h1 {
      font-size: 1.3em;
      font-weight: normal;
      line-height: 1.3;
      margin-bottom: 0.5em;
      word-wrap: break-word;
    }
    .title-page .meta {
      font-size: 0.9em;
      color: #555;
    }
    .title-page .divider {
      width: 3em;
      border-top: 1px solid #ccc;
      margin: 1.2em 0;
    }
    .title-page .summary {
      font-size: 0.95em;
      font-style: italic;
      line-height: 1.5;
      color: #333;
      margin-top: 0.5em;
    }
    .title-page .summary p {
      margin: 0;
    }
  </style>
</head>
<body>
  ${thumbnailHtml}<div class="title-page">
    <h1>${escapeXml(video.title)}</h1>
    <div class="divider"></div>
    <div class="meta">
      <p>${escapeXml(video.channel)}</p>
      ${video.uploadDate ? `<p>${formatUploadDate(video.uploadDate)}</p>` : ""}
      <p>Transcript via YouTube auto-captions</p>
    </div>
    <div class="divider"></div>${summaryHtml}
  </div>
</body>
</html>`;
}

function chapterXhtml(video: VideoMeta, bodyHtml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <title>${escapeXml(video.title)}</title>
  <style>
    body {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 1.05em;
      line-height: 1.6;
      margin: 0;
      padding: 0.5em;
      color: #1a1a1a;
    }
    p {
      margin: 0 0 0.8em;
      text-indent: 1.2em;
    }
    p:first-child {
      text-indent: 0;
    }
  </style>
</head>
<body>
  ${bodyHtml}
</body>
</html>`;
}

function containerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}

function contentOpf(video: VideoMeta, bookId: string, hasCoverImage: boolean): string {
  const coverImageMeta = hasCoverImage
    ? `\n    <meta name="cover" content="cover-img"/>`
    : "";
  const coverImageItem = hasCoverImage
    ? `\n    <item id="cover-img" href="cover.jpg" media-type="image/jpeg"/>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${escapeXml(video.title)}</dc:title>
    <dc:creator opf:role="aut">${escapeXml(video.channel)}</dc:creator>
    <dc:publisher>YouTube (via kobo-loader)</dc:publisher>
    <dc:language>en</dc:language>
    <dc:identifier id="bookid" opf:scheme="UUID">urn:uuid:${bookId}</dc:identifier>
    <dc:subject>${escapeXml(video.channel)}</dc:subject>
    <meta name="calibre:series" content="${escapeXml(video.channel)}"/>${coverImageMeta}
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>${coverImageItem}
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="cover"/>
    <itemref idref="chapter1"/>
  </spine>
  <guide>
    <reference type="cover" title="Cover" href="cover.xhtml"/>
    <reference type="text" title="Transcript" href="chapter1.xhtml"/>
  </guide>
</package>`;
}

function tocNcx(video: VideoMeta, bookId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${bookId}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle>
    <text>${escapeXml(video.title)}</text>
  </docTitle>
  <navMap>
    <navPoint id="navpoint-1" playOrder="1">
      <navLabel>
        <text>${escapeXml(video.title)}</text>
      </navLabel>
      <content src="chapter1.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`;
}

function transcriptToHtml(text: string): string {
  return text
    .split("\n\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${escapeXml(p)}</p>`)
    .join("\n");
}

function formatUploadDate(yyyymmdd: string): string {
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const y = yyyymmdd.slice(0, 4);
  const m = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  return `${d} ${months[m]} ${y}`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
