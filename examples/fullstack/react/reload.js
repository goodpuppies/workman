// The development server prefixes this file with its startup revision.
async function checkForReload() {
  try {
    const response = await fetch("/__wm/revision", {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok && await response.text() !== revision) {
      location.reload();
      return;
    }
  } catch {
    // Rebuilds and compilation errors temporarily leave the server unavailable.
  }
  setTimeout(checkForReload, 500);
}
setTimeout(checkForReload, 500);
