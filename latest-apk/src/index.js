// Redirects to the most recently modified APK for an environment in a public Google Drive folder.
//   GET /dev   /test   /pilot          -> 302 to that environment's latest APK download
//   GET /dev/info  /test/info  ...     -> JSON describing the file the redirect would serve
//
// A file belongs to an environment when its name ends in ".apk" and contains the
// environment word as a separate token (case-insensitive), e.g. "longevity-dev-release 18Nov.apk".
// "dev" does not match inside "device", and "test" does not match inside "latest".

const DRIVE_FILES_API = "https://www.googleapis.com/drive/v3/files";
const DRIVE_MAX_PAGE_SIZE = "1000";

const ENVIRONMENTS = Object.freeze({
  dev: "dev",
  test: "test",
  pilot: "pilot",
});

const textResponse = (message, status) =>
  new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const matcherFor = (word) =>
  new RegExp(`(^|[^a-z0-9])${escapeRegExp(word)}([^a-z0-9]|$)`, "i");

const isApkFor = (word) => {
  const tokenPattern = matcherFor(word);
  return (file) => {
    const name = file.name.toLowerCase();
    return name.endsWith(".apk") && tokenPattern.test(name.slice(0, -".apk".length));
  };
};

/** Lists the folder's files, newest first. */
async function listFolderFiles(folderId, apiKey) {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    orderBy: "modifiedTime desc",
    pageSize: DRIVE_MAX_PAGE_SIZE,
    fields: "files(id,name,mimeType,modifiedTime,size)",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    key: apiKey,
  });

  const res = await fetch(`${DRIVE_FILES_API}?${params}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Drive API ${res.status}: ${body.slice(0, 500)}`);
  }

  const { files = [] } = await res.json();
  return files;
}

/** Splits "/dev/info" into { envKey: "dev", wantsInfo: true }; returns null for unknown paths. */
function parseRoute(pathname) {
  const parts = pathname.toLowerCase().split("/").filter(Boolean);
  const [envKey, sub, ...rest] = parts;
  if (!envKey || !Object.hasOwn(ENVIRONMENTS, envKey) || rest.length > 0) return null;
  if (sub !== undefined && sub !== "info") return null;
  return { envKey, wantsInfo: sub === "info" };
}

const usageText = () =>
  "Latest APK links:\n" +
  Object.keys(ENVIRONMENTS).map((key) => `  /${key}   (details: /${key}/info)`).join("\n");

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/") return textResponse(usageText(), 200);

    const route = parseRoute(pathname);
    if (!route) return textResponse(`Not found.\n\n${usageText()}`, 404);

    if (!env.GOOGLE_API_KEY || !env.FOLDER_ID) {
      console.error("Missing GOOGLE_API_KEY secret or FOLDER_ID var");
      return textResponse("Server is not configured.", 500);
    }

    let files;
    try {
      files = await listFolderFiles(env.FOLDER_ID, env.GOOGLE_API_KEY);
    } catch (err) {
      console.error(err);
      return textResponse("Could not reach Google Drive. Please try again shortly.", 502);
    }

    const word = ENVIRONMENTS[route.envKey];
    const latest = files.find(isApkFor(word));
    if (!latest) {
      return textResponse(`No ${word.toUpperCase()} APK found in the folder yet.`, 404);
    }

    if (route.wantsInfo) {
      return Response.json(
        { environment: route.envKey, ...latest },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const downloadUrl =
      `https://drive.usercontent.google.com/download?id=${encodeURIComponent(latest.id)}` +
      `&export=download&confirm=t`;

    return new Response(null, {
      status: 302,
      headers: { Location: downloadUrl, "Cache-Control": "no-store" },
    });
  },
};
