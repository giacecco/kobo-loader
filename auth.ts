/**
 * One-time OAuth helper — run this LOCALLY to get a refresh token.
 *
 * Usage:
 *   1. Create an OAuth 2.0 Client ID in GCP Console (Desktop app type)
 *   2. Download the client secret JSON or note the client ID and secret
 *   3. Run: bun run auth.ts
 *   4. Copy the resulting credentials.json to your server
 *
 * Server-side, the refresh token never expires and is used for daily auth.
 */

import { google } from "googleapis";
import { writeFileSync } from "fs";
import http from "http";
import { URL } from "url";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  "http://localhost:3099/oauth2callback",
);

const scopes = ["https://www.googleapis.com/auth/drive.file"];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: scopes,
  prompt: "consent",
});

console.log("Open this URL in your browser:\n");
console.log(authUrl);
console.log();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:3099`);
  const code = url.searchParams.get("code");

  if (!code) {
    res.end("No code received.");
    server.close();
    process.exit(1);
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    const credentials = {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
    };
    writeFileSync("credentials/oauth2.json", JSON.stringify(credentials, null, 2));
    console.log("Credentials saved to credentials/oauth2.json");
    console.log("Copy this file to your server at kobo-loader/credentials/oauth2.json");

    res.end("Done! You can close this window.");
    server.close();
  } catch (err) {
    console.error("Failed to get tokens:", err);
    res.end("Error. Check the console.");
    server.close();
    process.exit(1);
  }
});

server.listen(3099);
