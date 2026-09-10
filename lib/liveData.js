import fs from "fs";
import path from "path";

const RAW_BASE =
  "https://raw.githubusercontent.com/max-collinas1/climate-collinas1/main";

function localJson(relPath, fallback) {
  const filePath = path.join(process.cwd(), relPath);

  if (!fs.existsSync(filePath)) return fallback;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function rawUrl(relPath) {
  const cleanPath = String(relPath)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  return `${RAW_BASE}/${cleanPath}?t=${Date.now()}`;
}

export async function readLiveJson(relPath, fallback = null) {
  try {
    const response = await fetch(rawUrl(relPath), {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub ${response.status}`);
    }

    return await response.json();
  } catch {
    return localJson(relPath, fallback);
  }
}

export async function readDailyLive() {
  const rows = await readLiveJson("data/daily.json", []);
  return Array.isArray(rows) ? rows : [];
}

export async function readRecordsLive() {
  return await readLiveJson("data/record.json", null);
}

export async function readIntradayLive(date) {
  const iso = String(date || "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return [];

  const rows = await readLiveJson(
    `public/data/intraday/${iso}.json`,
    [],
  );

  return Array.isArray(rows) ? rows : [];
}

export async function readMonthlyOverridesLive() {
  const rows = await readLiveJson("data/monthly_overrides.json", []);
  return Array.isArray(rows) ? rows : [];
}