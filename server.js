const path = require("path");
const express = require("express");

const app = express();
const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "public");
const curseForgeApiBase = "https://api.curseforge.com";

app.disable("x-powered-by");

loadLocalEnv();

function loadLocalEnv() {
  const envPath = path.join(__dirname, ".env");

  try {
    const content = require("fs").readFileSync(envPath, "utf8");

    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || process.env[match[1]]) continue;

      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env is optional; regular environment variables still work.
  }
}

app.get("/api/curseforge/status", (_req, res) => {
  res.status(200).json({
    configured: Boolean(process.env.CURSEFORGE_API_KEY),
  });
});

app.get("/api/curseforge/download/:modId/:fileId", async (req, res) => {
  if (!process.env.CURSEFORGE_API_KEY) {
    res.status(503).json({ error: "CURSEFORGE_API_KEY is not configured." });
    return;
  }

  try {
    const downloadResponse = await fetch(
      `${curseForgeApiBase}/v1/mods/${encodeURIComponent(req.params.modId)}/files/${encodeURIComponent(req.params.fileId)}/download-url`,
      {
        headers: {
          Accept: "application/json",
          "x-api-key": process.env.CURSEFORGE_API_KEY,
        },
      },
    );

    if (!downloadResponse.ok) {
      res.status(downloadResponse.status).json({ error: await downloadResponse.text() });
      return;
    }

    const { data: downloadUrl } = await downloadResponse.json();
    if (!downloadUrl) {
      res.status(404).json({ error: "CurseForge did not provide a download URL for this file." });
      return;
    }

    const fileResponse = await fetch(downloadUrl);
    if (!fileResponse.ok) {
      res.status(fileResponse.status).json({ error: `Download failed: ${fileResponse.statusText}` });
      return;
    }

    res.setHeader("Content-Type", fileResponse.headers.get("content-type") || "application/java-archive");
    res.setHeader("Cache-Control", "private, max-age=3600");

    const contentLength = fileResponse.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);

    const arrayBuffer = await fileResponse.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/curseforge/*", async (req, res) => {
  if (!process.env.CURSEFORGE_API_KEY) {
    res.status(503).json({ error: "CURSEFORGE_API_KEY is not configured." });
    return;
  }

  const upstreamPath = req.path.replace(/^\/api\/curseforge/, "");
  const url = new URL(`${curseForgeApiBase}${upstreamPath}`);

  for (const [key, value] of Object.entries(req.query)) {
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "x-api-key": process.env.CURSEFORGE_API_KEY,
      },
    });
    const text = await response.text();

    res.status(response.status);
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/json");
    res.send(text);
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.use(
  express.static(publicDir, {
    extensions: ["html"],
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-store");
      }
    },
  })
);

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const server = app.listen(port, () => {
  const curseForgeStatus = process.env.CURSEFORGE_API_KEY ? "enabled" : "disabled: set CURSEFORGE_API_KEY in .env";
  console.log(`Packsplit is running on port ${port}`);
  console.log(`CurseForge is ${curseForgeStatus}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the existing server or set PORT to another value.`);
    process.exit(1);
  }

  throw error;
});
