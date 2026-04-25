const API_BASE = "https://api.modrinth.com/v2";
const CURSEFORGE_API_BASE = "/api/curseforge/v1";
const CURSEFORGE_MINECRAFT_GAME_ID = 432;
const CURSEFORGE_MOD_CLASS_ID = 6;
const CURSEFORGE_LOADER_TYPES = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6,
};
const FABRIC_META_BASE = "https://meta.fabricmc.net/v2";
const FORGE_MAVEN_BASE = "https://maven.minecraftforge.net/net/minecraftforge/forge";
const NEOFORGE_MAVEN_BASE = "https://maven.neoforged.net/releases/net/neoforged/neoforge";
const QUILT_INSTALLER_MAVEN_BASE = "https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer";
const DEFAULT_SERVER_MEMORY_MB = 4096;
const DB_NAME = "modsmanager";
const DB_VERSION = 3;
const PACK_STORE = "modpacks";
const SEARCH_CACHE_STORE = "searchCache";
const MOD_FILE_STORE = "modFiles";
const SEARCH_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const LEGACY_STORAGE_KEY = "modsmanager.pack.v1";
const PACK_MENU_COLLAPSED_KEY = "modsmanager.packMenuCollapsed.v1";
const FALLBACK_MINECRAFT_VERSIONS = [
  "1.21.5",
  "1.21.4",
  "1.21.3",
  "1.21.2",
  "1.21.1",
  "1.21",
  "1.20.6",
  "1.20.5",
  "1.20.4",
  "1.20.3",
  "1.20.2",
  "1.20.1",
  "1.20",
  "1.19.4",
  "1.19.3",
  "1.19.2",
  "1.19.1",
  "1.19",
  "1.18.2",
  "1.18.1",
  "1.18",
  "1.17.1",
  "1.17",
  "1.16.5",
];

let db;
let packs = [];
let state = defaultPack();
let minecraftVersions = FALLBACK_MINECRAFT_VERSIONS;
let checkingCompatibility = false;
let activeDetailRequest = 0;
let activeCustomSelect = null;
let dialogState = null;
let currentView = "home";
let curseForgeAvailable = false;

const HISTORY_APP_KEY = "packsplit";

const els = {
  brandLink: document.querySelector(".brand-link"),
  packLibrary: document.querySelector(".pack-library"),
  packMenu: document.querySelector("#packMenu"),
  togglePackMenu: document.querySelector("#togglePackMenu"),
  currentPackSummary: document.querySelector("#currentPackSummary"),
  packList: document.querySelector("#packList"),
  newPack: document.querySelector("#newPack"),
  importPack: document.querySelector("#importPack"),
  importPackFile: document.querySelector("#importPackFile"),
  deletePack: document.querySelector("#deletePack"),
  packName: document.querySelector("#packName"),
  minecraftVersion: document.querySelector("#minecraftVersion"),
  loader: document.querySelector("#loader"),
  searchInput: document.querySelector("#searchInput"),
  searchButton: document.querySelector("#searchButton"),
  status: document.querySelector("#status"),
  modDetail: document.querySelector("#modDetail"),
  results: document.querySelector("#results"),
  clientMods: document.querySelector("#clientMods"),
  bothMods: document.querySelector("#bothMods"),
  serverMods: document.querySelector("#serverMods"),
  clientCount: document.querySelector("#clientCount"),
  bothCount: document.querySelector("#bothCount"),
  serverCount: document.querySelector("#serverCount"),
  exportClient: document.querySelector("#exportClient"),
  exportServer: document.querySelector("#exportServer"),
  clearPack: document.querySelector("#clearPack"),
  databaseSize: document.querySelector("#databaseSize"),
};

els.brandLink.addEventListener("click", goHome);
els.togglePackMenu.addEventListener("click", togglePackMenu);
els.searchButton.addEventListener("click", searchMods);
els.searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    searchMods();
  }
});

els.newPack.addEventListener("click", createPack);
els.importPack.addEventListener("click", () => els.importPackFile.click());
els.importPackFile.addEventListener("change", importSelectedPack);
els.deletePack.addEventListener("click", deleteCurrentPack);

for (const input of [els.packName, els.minecraftVersion, els.loader]) {
  input.addEventListener("change", syncSettings);
}
els.minecraftVersion.addEventListener("change", handleCompatibilitySettingChange);
els.loader.addEventListener("change", handleCompatibilitySettingChange);

els.exportClient.addEventListener("click", () => exportSide("client"));
els.exportServer.addEventListener("click", () => exportSide("server"));
els.clearPack.addEventListener("click", clearPack);
document.addEventListener("click", handleDocumentClick);
document.addEventListener("keydown", handleDocumentKeydown);
window.addEventListener("popstate", handleHistoryNavigation);

initializeCustomSelects();
initializeHistoryState();

init();

function defaultPack() {
  const now = new Date().toISOString();

  return {
    id: createId(),
    name: "My Modpack",
    minecraftVersion: "1.20.1",
    loader: "fabric",
    mods: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function init() {
  setStatus("Opening modpack database...");

  try {
    curseForgeAvailable = await loadCurseForgeStatus();
    minecraftVersions = await loadMinecraftVersions();
    db = await openDatabase();
    await migrateLegacyPack();
    packs = await getAllPacks();

    if (packs.length === 0) {
      state = defaultPack();
      await savePack();
      packs = await getAllPacks();
    } else {
      state = normalizePack(packs[0]);
    }

    populateMinecraftVersions(minecraftVersions);
    hydrateControls();
    renderPackSelector();
    renderPack();
    updateDatabaseSizeCounter();
    setStatus(`Loaded ${state.name}. Your modpacks are saved in this browser.${curseForgeAvailable ? "" : " CurseForge needs an API key, so search is using Modrinth."}`);
  } catch (error) {
    setStatus(`Could not open the modpack database: ${error.message}`);
    minecraftVersions = FALLBACK_MINECRAFT_VERSIONS;
    populateMinecraftVersions(minecraftVersions);
    hydrateControls();
    renderPack();
  }
}

async function loadCurseForgeStatus() {
  try {
    const status = await getJson("/api/curseforge/status");
    return Boolean(status.configured);
  } catch {
    return false;
  }
}

async function loadMinecraftVersions() {
  try {
    const versions = await getJson(`${API_BASE}/tag/game_version`);
    const releases = versions
      .filter((version) => version.version_type === "release")
      .map((version) => version.version)
      .filter(isMinecraftReleaseVersion)
      .sort(compareMinecraftVersionsDesc);

    return releases.length ? releases : FALLBACK_MINECRAFT_VERSIONS;
  } catch {
    return FALLBACK_MINECRAFT_VERSIONS;
  }
}

function populateMinecraftVersions(versions) {
  const selectedVersion = state.minecraftVersion || "1.20.1";
  const allVersions = [selectedVersion, ...versions].filter(isMinecraftReleaseVersion);
  const uniqueVersions = [...new Set(allVersions)].sort(compareMinecraftVersionsDesc);

  els.minecraftVersion.replaceChildren();

  for (const version of uniqueVersions) {
    const option = document.createElement("option");
    option.value = version;
    option.textContent = version;
    option.selected = version === selectedVersion;
    els.minecraftVersion.append(option);
  }

  syncCustomSelect(els.minecraftVersion);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(PACK_STORE)) {
        const store = database.createObjectStore(PACK_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }

      if (!database.objectStoreNames.contains(SEARCH_CACHE_STORE)) {
        const store = database.createObjectStore(SEARCH_CACHE_STORE, { keyPath: "key" });
        store.createIndex("expiresAt", "expiresAt");
      }

      if (!database.objectStoreNames.contains(MOD_FILE_STORE)) {
        const store = database.createObjectStore(MOD_FILE_STORE, { keyPath: "key" });
        store.createIndex("cachedAt", "cachedAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function migrateLegacyPack() {
  let legacy;

  try {
    legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return;
  }

  if (!legacy) return;

  try {
    const migrated = normalizePack(JSON.parse(legacy));
    migrated.name = `${migrated.name || "My Modpack"} (imported)`;
    migrated.updatedAt = new Date().toISOString();
    await putPack(migrated);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // A broken legacy draft should not prevent the IndexedDB app from opening.
  }
}

function getAllPacks() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PACK_STORE, "readonly");
    const request = transaction.objectStore(PACK_STORE).getAll();

    request.onsuccess = () => {
      resolve(request.result.map(normalizePack).sort(sortByUpdated));
    };
    request.onerror = () => reject(request.error);
  });
}

function putPack(pack) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PACK_STORE, "readwrite");
    const request = transaction.objectStore(PACK_STORE).put(normalizePack(pack));

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function removePack(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PACK_STORE, "readwrite");
    const request = transaction.objectStore(PACK_STORE).delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function getCachedSearch(key, { allowExpired = false } = {}) {
  if (!db) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SEARCH_CACHE_STORE, "readonly");
    const request = transaction.objectStore(SEARCH_CACHE_STORE).get(key);

    request.onsuccess = () => {
      const cached = request.result;

      if (!cached) {
        resolve(null);
        return;
      }

      const isExpired = Date.now() > Date.parse(cached.expiresAt);

      if (isExpired && !allowExpired) {
        resolve(null);
        return;
      }

      resolve(cached);
    };
    request.onerror = () => reject(request.error);
  });
}

function putCachedSearch(entry) {
  if (!db) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SEARCH_CACHE_STORE, "readwrite");
    const request = transaction.objectStore(SEARCH_CACHE_STORE).put(entry);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function getCachedModFile(key) {
  if (!db) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MOD_FILE_STORE, "readonly");
    const request = transaction.objectStore(MOD_FILE_STORE).get(key);

    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

function putCachedModFile(entry) {
  if (!db) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MOD_FILE_STORE, "readwrite");
    const request = transaction.objectStore(MOD_FILE_STORE).put(entry);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function getModFileCacheStats() {
  if (!db) return Promise.resolve({ count: 0, bytes: 0 });

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MOD_FILE_STORE, "readonly");
    const request = transaction.objectStore(MOD_FILE_STORE).openCursor();
    let count = 0;
    let bytes = 0;

    request.onsuccess = () => {
      const cursor = request.result;

      if (!cursor) {
        resolve({ count, bytes });
        return;
      }

      count += 1;
      bytes += Number(cursor.value?.size ?? cursor.value?.blob?.size ?? 0);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

async function updateDatabaseSizeCounter() {
  if (!els.databaseSize) return;

  try {
    const { count, bytes } = await getModFileCacheStats();
    els.databaseSize.textContent = `Database: ${formatBytes(bytes)} / ${count} jar${count === 1 ? "" : "s"}`;
  } catch {
    els.databaseSize.textContent = "Database: unavailable";
  }
}

async function savePack(refreshSelector = false) {
  if (!db) return;

  state.updatedAt = new Date().toISOString();
  await putPack(state);

  if (refreshSelector) {
    packs = await getAllPacks();
    renderPackSelector();
  }
}

function hydrateControls() {
  els.packName.value = state.name;
  els.minecraftVersion.value = state.minecraftVersion;
  els.loader.value = state.loader;
  syncCustomSelect(els.minecraftVersion);
  syncCustomSelect(els.loader);
  renderCurrentPackSummary();
}

async function syncSettings(event) {
  if (event?.target === els.minecraftVersion || event?.target === els.loader) return;

  state.name = els.packName.value.trim() || "Untitled Modpack";
  state.minecraftVersion = els.minecraftVersion.value.trim();
  state.loader = els.loader.value;
  await savePack(true);
  renderPack();
}

async function handleCompatibilitySettingChange() {
  if (checkingCompatibility) return;

  const previousVersion = state.minecraftVersion;
  const previousLoader = state.loader;
  const nextVersion = els.minecraftVersion.value;
  const nextLoader = els.loader.value;

  state.name = els.packName.value.trim() || "Untitled Modpack";

  if (nextVersion === previousVersion && nextLoader === previousLoader) {
    await savePack(true);
    return;
  }

  state.minecraftVersion = nextVersion;
  state.loader = nextLoader;
  clearCompatibilityWarnings();
  await savePack(true);
  renderPack();

  if (!state.mods.length) {
    setStatus(`Compatibility target changed to ${nextLoader} ${nextVersion}.`);
    return;
  }

  await reviewModCompatibility(nextVersion, nextLoader);
}

async function reviewModCompatibility(nextVersion, nextLoader) {
  checkingCompatibility = true;
  setControlsDisabled(true);
  setStatus(`Checking ${state.mods.length} mods for ${nextLoader} ${nextVersion} compatibility...`);

  const updates = [];
  const incompatible = [];
  const failed = [];
  let shouldUpdate = false;

  for (const mod of state.mods) {
    try {
      const version = await resolveLatestVersionFor(mod.projectId, nextVersion, nextLoader);
      updates.push({ mod, version });
    } catch (error) {
      incompatible.push({ mod, error });
    }
  }

  markCompatibilityWarnings(updates, incompatible);
  renderPack();

  const updateCount = updates.filter(({ mod, version }) => mod.versionId !== getResolvedVersionId(mod, version)).length;

  if (incompatible.length || updateCount) {
    const messageParts = [];

    if (incompatible.length) {
      messageParts.push(`${incompatible.length} mod${incompatible.length === 1 ? " is" : "s are"} incompatible with ${nextVersion}.`);
    }

    if (updateCount) {
      messageParts.push(`${updateCount} mod${updateCount === 1 ? " has" : "s have"} compatible updates.`);
    }

    shouldUpdate =
      updateCount > 0 &&
      (await appConfirm(`${messageParts.join("\n")}\n\nUpdate the compatible mods automatically for ${nextLoader} ${nextVersion}?`, {
        title: "Update compatible mods?",
        confirmText: "Update mods",
      }));

    if (shouldUpdate) {
      setStatus(`Updating ${updateCount} compatible mods for ${nextVersion}...`);

      for (const item of updates) {
        if (item.mod.versionId === getResolvedVersionId(item.mod, item.version)) continue;

        try {
          applyVersionToMod(item.mod, item.version);
        } catch (error) {
          failed.push({ mod: item.mod, error });
        }
      }
    }
  }

  for (const { mod } of updates) {
    if (!failed.some((item) => item.mod.projectId === mod.projectId)) {
      const checkedVersion = updates.find((item) => item.mod === mod)?.version;
      mod.compatibilityStatus = checkedVersion && mod.versionId === getResolvedVersionId(mod, checkedVersion) ? "compatible" : mod.compatibilityStatus;
      mod.compatibilityMessage = mod.compatibilityStatus === "compatible" ? "" : mod.compatibilityMessage;
    }
  }

  for (const { mod, error } of failed) {
    mod.compatibilityStatus = "update-failed";
    mod.compatibilityMessage = `Automatic update failed: ${error.message}`;
  }

  await savePack(true);
  renderPack();
  setControlsDisabled(false);
  checkingCompatibility = false;

  const warnings = [];
  if (incompatible.length) warnings.push(`${incompatible.length} mod${incompatible.length === 1 ? "" : "s"} could not be updated because no compatible ${nextLoader} ${nextVersion} file was found.`);
  if (failed.length) warnings.push(`${failed.length} mod${failed.length === 1 ? "" : "s"} could not be updated automatically.`);

  if (warnings.length) {
    setStatus(`${warnings.join(" ")} Please review the warnings in the mod list.`);
  } else if (shouldUpdate && updateCount) {
    setStatus(`Updated compatible mods for ${nextVersion}.`);
  } else if (updateCount) {
    setStatus(`${updateCount} compatible update${updateCount === 1 ? "" : "s"} left for review.`);
  } else {
    setStatus(`All mods are already compatible with ${nextVersion}.`);
  }
}

function renderPackSelector() {
  renderCurrentPackSummary();
  els.packList.replaceChildren();

  for (const pack of packs) {
    const item = document.createElement("button");
    const isActive = pack.id === state.id;

    item.className = `pack-list-item${isActive ? " active" : ""}`;
    item.type = "button";
    item.role = "option";
    item.dataset.packId = pack.id;
    item.ariaSelected = String(isActive);
    item.innerHTML = `
      <span class="pack-list-name">${escapeHtml(pack.name)}</span>
      <span class="pack-list-meta">
        <span>${escapeHtml(pack.loader)} ${escapeHtml(pack.minecraftVersion)}</span>
        <strong>${pack.mods.length}</strong>
      </span>
    `;
    item.addEventListener("click", () => switchPack(pack.id));
    els.packList.append(item);
  }

  syncPackMenuVisibility();
}

async function switchPack(packId) {
  const selected = packs.find((pack) => pack.id === packId);

  if (!selected) return;

  state = normalizePack(selected);
  hydrateControls();
  renderPackSelector();
  renderPack();
  setStatus(`Opened ${state.name}.`);
}

function renderCurrentPackSummary() {
  els.currentPackSummary.textContent = `${state.name} · ${state.mods.length} mod${state.mods.length === 1 ? "" : "s"}`;
}

function togglePackMenu() {
  const collapsed = !els.packLibrary.classList.contains("collapsed");
  setPackMenuCollapsed(collapsed);
  savePackMenuPreference(collapsed);
}

function syncPackMenuVisibility() {
  setPackMenuCollapsed(loadPackMenuPreference());
}

function setPackMenuCollapsed(collapsed) {
  els.packLibrary.classList.toggle("collapsed", collapsed);
  els.packMenu.hidden = collapsed;
  els.togglePackMenu.textContent = collapsed ? "Show" : "Hide";
  els.togglePackMenu.ariaExpanded = String(!collapsed);
}

function loadPackMenuPreference() {
  try {
    return localStorage.getItem(PACK_MENU_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function savePackMenuPreference(collapsed) {
  try {
    localStorage.setItem(PACK_MENU_COLLAPSED_KEY, String(collapsed));
  } catch {
    // The menu still works if browser storage is unavailable.
  }
}

async function createPack() {
  await savePack();

  state = {
    ...defaultPack(),
    name: uniquePackName("New Modpack"),
    minecraftVersion: els.minecraftVersion.value.trim() || "1.20.1",
    loader: els.loader.value,
  };

  await savePack(true);
  hydrateControls();
  renderPack();
  setStatus(`${state.name} is ready to edit.`);
}

async function deleteCurrentPack() {
  if (!(await appConfirm(`Delete "${state.name}" from saved modpacks?`, {
    title: "Delete saved pack?",
    confirmText: "Delete pack",
    danger: true,
  }))) return;

  await removePack(state.id);
  packs = await getAllPacks();

  if (packs.length === 0) {
    state = defaultPack();
    await savePack();
    packs = await getAllPacks();
  } else {
    state = normalizePack(packs[0]);
  }

  hydrateControls();
  renderPackSelector();
  renderPack();
  setStatus(`Deleted the modpack. Opened ${state.name}.`);
}

async function importSelectedPack(event) {
  const file = event.target.files?.[0];
  event.target.value = "";

  if (!file) return;

  setControlsDisabled(true);

  try {
    setStatus(`Reading ${file.name}...`);
    const zip = await readZipFile(file);
    const imported = await createPackFromImport(file, zip);

    state = normalizePack(imported);
    await savePack(true);
    populateMinecraftVersions(minecraftVersions);
    hydrateControls();
    renderPackSelector();
    renderPack();

    if (state.mods.length) {
      await reviewModCompatibility(state.minecraftVersion, state.loader);
    }

    const unresolved = state.mods.filter((mod) => mod.compatibilityStatus && mod.compatibilityStatus !== "compatible").length;
    const suffix = unresolved ? ` ${unresolved} mod${unresolved === 1 ? "" : "s"} need review.` : " Everything passed compatibility checks.";
    setStatus(`Imported ${state.name} with ${state.mods.length} mod${state.mods.length === 1 ? "" : "s"}.${suffix}`);
  } catch (error) {
    setStatus(`Import failed: ${error.message}`);
  } finally {
    setControlsDisabled(false);
  }
}

async function createPackFromImport(file, zip) {
  const exportedManifest = await readOptionalJson(zip, "manifest.json");
  if (exportedManifest?.mods?.length) {
    return packFromPacksplitManifest(file, exportedManifest);
  }

  const modrinthIndex = await readOptionalJson(zip, "modrinth.index.json");
  const prismPack = await readOptionalJson(zip, "mmc-pack.json");
  const imported = {
    ...defaultPack(),
    name: uniquePackName(stripArchiveExtension(file.name)),
    minecraftVersion: detectImportedMinecraftVersion(prismPack, modrinthIndex) || state.minecraftVersion,
    loader: detectImportedLoader(prismPack, modrinthIndex) || state.loader,
    mods: [],
  };

  const entries = await collectIndexedImportEntries(zip, modrinthIndex);
  const hashEntries = entries.length ? [] : await collectJarHashImportEntries(zip);
  const importEntries = entries.length ? entries : hashEntries;

  if (!importEntries.length) {
    throw new Error("No Modrinth mod entries were found in this archive.");
  }

  for (let index = 0; index < importEntries.length; index += 1) {
    const entry = importEntries[index];
    setStatus(`Importing ${entry.name || entry.fileName || entry.projectId || "mod"} (${index + 1}/${importEntries.length})...`);
    const version = entry.versionId
      ? await getJson(`${API_BASE}/version/${entry.versionId}`)
      : entry.version;
    const projectId = entry.projectId || version.project_id;
    const project = await getJson(`${API_BASE}/project/${projectId}`);
    const mod = createSavedMod(project, version, {});

    mod.side = normalizeImportSide(entry.side) || inferSide(mod.clientSide, mod.serverSide);
    mod.fileName = entry.fileName || mod.fileName;
    mod.autoInstalled = false;
    imported.mods = imported.mods.filter((candidate) => candidate.projectId !== mod.projectId);
    imported.mods.push(mod);
  }

  linkImportedDependencies(imported.mods);
  return imported;
}

function packFromPacksplitManifest(file, manifest) {
  const pack = {
    ...defaultPack(),
    name: uniquePackName(manifest.name || stripArchiveExtension(file.name)),
    minecraftVersion: manifest.minecraftVersion || state.minecraftVersion,
    loader: manifest.loader || state.loader,
    mods: (manifest.mods ?? []).map((mod) => normalizeSavedMod(mod)),
  };

  linkImportedDependencies(pack.mods);
  return pack;
}

async function collectIndexedImportEntries(zip, modrinthIndex) {
  if (modrinthIndex?.files?.length) {
    const entries = modrinthIndex.files
      .filter((file) => /(?:^|\/)mods\/[^/]+\.jar$/i.test(file?.path || ""))
      .filter((file) => file?.env?.client !== "unsupported" || file?.env?.server !== "unsupported")
      .map((file) => ({
        name: file.path,
        fileName: file.path?.split("/").at(-1),
        side: inferSideFromEnv(file.env),
        hashes: file.hashes,
      }))
      .filter((entry) => entry.hashes?.sha512 || entry.hashes?.sha1);

    return resolveHashEntries(entries);
  }

  const indexFiles = zip.entries.filter((entry) => /(?:^|\/)mods\/\.index\/[^/]+\.pw\.toml$/i.test(entry.name));
  const entries = [];

  for (const entry of indexFiles) {
    const parsed = parsePackwizToml(await zip.readText(entry.name));
    if (parsed.projectId || parsed.versionId) entries.push(parsed);
  }

  return entries;
}

async function collectJarHashImportEntries(zip) {
  const jarEntries = zip.entries.filter((entry) => /(?:^|\/)mods\/[^/]+\.jar$/i.test(entry.name));
  const entries = [];

  for (let index = 0; index < jarEntries.length; index += 1) {
    const entry = jarEntries[index];
    setStatus(`Hashing local jar ${index + 1}/${jarEntries.length}...`);
    const data = await zip.readBinary(entry.name);
    const sha512 = await digestHex("SHA-512", data);
    entries.push({
      name: entry.name,
      fileName: entry.name.split("/").at(-1),
      hashes: { sha512 },
    });
  }

  return resolveHashEntries(entries);
}

async function resolveHashEntries(entries) {
  const sha512Entries = entries.filter((entry) => entry.hashes?.sha512);
  const sha1Entries = entries.filter((entry) => !entry.hashes?.sha512 && entry.hashes?.sha1);
  const resolved = [];

  resolved.push(...(await resolveHashEntryGroup(sha512Entries, "sha512")));
  resolved.push(...(await resolveHashEntryGroup(sha1Entries, "sha1")));

  return resolved;
}

async function resolveHashEntryGroup(entries, algorithm) {
  if (!entries.length) return [];

  const hashes = entries.map((entry) => entry.hashes[algorithm]);
  const versionsByHash = await postJson(`${API_BASE}/version_files`, { hashes, algorithm });

  return entries
    .map((entry) => ({
      ...entry,
      version: versionsByHash[entry.hashes[algorithm]],
    }))
    .filter((entry) => entry.version);
}

function parsePackwizToml(text) {
  return {
    name: readTomlString(text, "name"),
    fileName: readTomlString(text, "filename"),
    side: readTomlString(text, "side"),
    projectId: readTomlString(text, "mod-id"),
    versionId: readTomlString(text, "version"),
    downloadUrl: readTomlString(text, "url"),
    hashes: {
      sha512: readTomlHash(text, "sha512"),
      sha1: readTomlHash(text, "sha1"),
    },
  };
}

function readTomlString(text, key) {
  const match = text.match(new RegExp(`^${escapeRegExp(key)}\\s*=\\s*['"]([^'"]+)['"]`, "m"));
  return match?.[1] || "";
}

function readTomlHash(text, algorithm) {
  const hashFormat = readTomlString(text, "hash-format");
  const hash = readTomlString(text, "hash");
  return hashFormat === algorithm ? hash : "";
}

function detectImportedMinecraftVersion(prismPack, modrinthIndex) {
  if (modrinthIndex?.dependencies?.minecraft) return modrinthIndex.dependencies.minecraft;
  return prismPack?.components?.find((component) => component.uid === "net.minecraft")?.version || "";
}

function detectImportedLoader(prismPack, modrinthIndex) {
  const dependencies = modrinthIndex?.dependencies ?? {};
  if (dependencies.fabric_loader) return "fabric";
  if (dependencies.forge) return "forge";
  if (dependencies.neoforge) return "neoforge";
  if (dependencies.quilt_loader) return "quilt";

  const loaderComponent = prismPack?.components?.find((component) =>
    ["net.fabricmc.fabric-loader", "net.minecraftforge", "net.neoforged", "org.quiltmc.quilt-loader"].includes(component.uid),
  );

  return {
    "net.fabricmc.fabric-loader": "fabric",
    "net.minecraftforge": "forge",
    "net.neoforged": "neoforge",
    "org.quiltmc.quilt-loader": "quilt",
  }[loaderComponent?.uid] || "";
}

function inferSideFromEnv(env = {}) {
  const client = env.client === "required" ? "required" : env.client === "unsupported" ? "unsupported" : "optional";
  const server = env.server === "required" ? "required" : env.server === "unsupported" ? "unsupported" : "optional";
  return inferSide(client, server);
}

function normalizeImportSide(side) {
  return ["client", "both", "server"].includes(side) ? side : "";
}

function linkImportedDependencies(mods) {
  const byProject = new Map(mods.map((mod) => [mod.projectId, mod]));

  for (const mod of mods) {
    mod.requiredBy = normalizeRequiredBy(mod.requiredBy);
    mod.dependencyIds = getRequiredDependencyIds(mod.dependencies);

    for (const dependencyId of mod.dependencyIds) {
      linkParentToDependency(mod, byProject.get(dependencyId));
    }
  }
}

async function readOptionalJson(zip, path) {
  if (!zip.has(path)) return null;
  return JSON.parse(await zip.readText(path));
}

function stripArchiveExtension(filename) {
  return String(filename).replace(/\.(mrpack|zip)$/i, "") || "Imported Modpack";
}

async function searchMods() {
  await syncSettings();

  const query = els.searchInput.value.trim();
  if (!query) {
    setStatus(`Type a mod name to search ${getSearchProviderLabel()}.`);
    return;
  }

  const limit = 12;
  const searchContext = {
    query,
    minecraftVersion: state.minecraftVersion,
    loader: state.loader,
    limit,
    index: "relevance",
  };
  const cacheKey = createSearchCacheKey(searchContext);
  let cached = null;

  try {
    cached = await getCachedSearch(cacheKey);
  } catch {
    cached = null;
  }

  if (cached) {
    showResultsView();
    renderResults(cached.hits ?? []);
    setStatus(`Loaded ${cached.hits?.length ?? 0} cached mods for ${state.loader} ${state.minecraftVersion}.`);
    return;
  }

  setStatus(`Searching ${getSearchProviderLabel()}...`);
  els.searchButton.disabled = true;

  try {
    const searchTasks = [searchModrinthMods(query, limit, searchContext.index)];
    if (curseForgeAvailable) searchTasks.push(searchCurseForgeMods(query, limit));

    const [modrinthResult, curseForgeResult] = await Promise.allSettled(searchTasks);
    const hits = [
      ...(modrinthResult.status === "fulfilled" ? modrinthResult.value : []),
      ...(curseForgeResult?.status === "fulfilled" ? curseForgeResult.value : []),
    ];
    const errors = [
      modrinthResult.status === "rejected" ? `Modrinth: ${modrinthResult.reason.message}` : "",
      curseForgeResult?.status === "rejected" ? formatCurseForgeSearchError(curseForgeResult.reason) : "",
    ].filter(Boolean);

    if (!hits.length && errors.length) {
      throw new Error(errors.join(" "));
    }

    const now = Date.now();

    try {
      await putCachedSearch({
        ...searchContext,
        key: cacheKey,
        source: "combined",
        hits,
        totalHits: hits.length,
        cachedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + SEARCH_CACHE_TTL_MS).toISOString(),
      });
    } catch {
      // Search should still work if the browser refuses to cache the result.
    }

    showResultsView();
    renderResults(hits);
    setStatus(`Found ${hits.length} matching mods for ${state.loader} ${state.minecraftVersion}${errors.length ? ` (${errors.join("; ")})` : curseForgeAvailable ? "." : ". CurseForge needs an API key, so this searched Modrinth only."}`);
  } catch (error) {
    let stale = null;

    try {
      stale = await getCachedSearch(cacheKey, { allowExpired: true });
    } catch {
      stale = null;
    }

    if (stale) {
      showResultsView();
      renderResults(stale.hits ?? []);
      setStatus(`Search failed, so showing ${stale.hits?.length ?? 0} older cached mods: ${error.message}`);
    } else {
      setStatus(`Search failed: ${error.message}`);
    }
  } finally {
    els.searchButton.disabled = false;
  }
}

function getSearchProviderLabel() {
  return curseForgeAvailable ? "Modrinth and CurseForge" : "Modrinth";
}

async function searchModrinthMods(query, limit, index) {
  const facets = JSON.stringify([
    ["project_type:mod"],
    [`versions:${state.minecraftVersion}`],
    [`categories:${state.loader}`],
  ]);
  const params = new URLSearchParams({
    query,
    facets,
    limit: String(limit),
    index,
  });
  const data = await getJson(`${API_BASE}/search?${params}`);
  return (data.hits ?? []).map(normalizeModrinthSearchProject);
}

async function searchCurseForgeMods(query, limit) {
  const params = new URLSearchParams({
    gameId: String(CURSEFORGE_MINECRAFT_GAME_ID),
    classId: String(CURSEFORGE_MOD_CLASS_ID),
    searchFilter: query,
    gameVersion: state.minecraftVersion,
    pageSize: String(limit),
    sortField: "2",
    sortOrder: "desc",
  });
  const loaderType = CURSEFORGE_LOADER_TYPES[state.loader];
  if (loaderType) params.set("modLoaderType", String(loaderType));

  const data = await getJson(`${CURSEFORGE_API_BASE}/mods/search?${params}`);
  return (data.data ?? []).map(normalizeCurseForgeProject);
}

function formatCurseForgeSearchError(error) {
  if (String(error?.message || "").includes("503")) {
    return "CurseForge: add CURSEFORGE_API_KEY to .env and restart the server";
  }

  return `CurseForge: ${error?.message || "unavailable"}`;
}

function normalizeModrinthSearchProject(project) {
  return {
    ...project,
    source: "modrinth",
    project_id: project.project_id || project.id,
  };
}

function normalizeCurseForgeProject(project) {
  const author = project.authors?.[0]?.name || "Unknown author";
  const categories = (project.categories ?? []).map((category) => category.name || category.slug).filter(Boolean);

  return {
    source: "curseforge",
    project_id: createCurseForgeProjectId(project.id),
    curseForgeId: project.id,
    slug: project.slug,
    title: project.name,
    description: project.summary || "",
    icon_url: project.logo?.thumbnailUrl || project.logo?.url || "",
    client_side: "unknown",
    server_side: "unknown",
    downloads: project.downloadCount ?? 0,
    followers: project.thumbsUpCount ?? 0,
    author,
    categories,
    loaders: [],
    body: project.summary || "",
    websiteUrl: project.links?.websiteUrl || project.url || `https://www.curseforge.com/minecraft/mc-mods/${project.slug}`,
    latestFiles: project.latestFiles ?? [],
    latestFilesIndexes: project.latestFilesIndexes ?? [],
  };
}

function createCurseForgeProjectId(id) {
  return `curseforge:${id}`;
}

function getProjectSource(project) {
  return project?.source || (String(project?.project_id || project?.projectId || "").startsWith("curseforge:") ? "curseforge" : "modrinth");
}

function getProjectKey(project) {
  const source = getProjectSource(project);
  if (source === "curseforge") return project.projectId || project.project_id || createCurseForgeProjectId(project.curseForgeId || project.id);
  return project.projectId || project.project_id || project.id;
}

function getCurseForgeId(project) {
  if (project?.curseForgeId) return project.curseForgeId;
  const id = project?.project_id || project?.projectId || project?.id;
  const match = String(id).match(/^curseforge:(\d+)$/);
  return match ? Number(match[1]) : Number(id);
}

function renderResults(results) {
  els.results.replaceChildren();

  if (results.length === 0) {
    els.results.append(emptyState("No compatible mods found for this search."));
    return;
  }

  for (const project of results) {
    const card = document.createElement("article");
    card.className = "result-card";
    card.tabIndex = 0;
    card.role = "button";

    const detectedSide = inferSide(project.client_side, project.server_side);
    const added = state.mods.some((mod) => mod.projectId === getProjectKey(project));
    const sourceLabel = getProjectSource(project) === "curseforge" ? "CurseForge" : "Modrinth";

    card.innerHTML = `
      <div class="card-title">
        <img class="icon" src="${escapeAttr(project.icon_url || "")}" alt="" />
        <div class="title-stack">
          <strong>${escapeHtml(project.title)}</strong>
          <span>${escapeHtml(project.author || "Unknown author")}</span>
        </div>
      </div>
      <p class="description">${escapeHtml(project.description || "No description provided.")}</p>
      <div class="badge-row">
        <span class="badge source-badge">${escapeHtml(sourceLabel)}</span>
        <span class="badge">${escapeHtml(detectedSide)}</span>
        <span class="badge">${formatNumber(project.downloads)} downloads</span>
      </div>
    `;
    card.title = `View ${project.title}`;
    card.addEventListener("click", () => showProjectPage(project));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showProjectPage(project);
      }
    });

    const button = document.createElement("button");
    button.className = "button primary";
    button.type = "button";
    button.textContent = added ? "Added" : "Add to pack";
    button.disabled = added;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      addProject(project, button);
    });
    card.append(button);

    els.results.append(card);
  }
}

function initializeHistoryState() {
  if (!history.state || history.state.app !== HISTORY_APP_KEY) {
    history.replaceState(createHistoryState("home"), "", location.href);
  }
}

function createHistoryState(view, data = {}) {
  return {
    app: HISTORY_APP_KEY,
    view,
    ...data,
  };
}

function setViewHistory(view, data = {}, mode = "push") {
  if (mode === "none") return;

  const entry = createHistoryState(view, data);

  if (mode === "replace") {
    history.replaceState(entry, "", location.href);
    return;
  }

  history.pushState(entry, "", location.href);
}

function handleHistoryNavigation(event) {
  const entry = event.state?.app === HISTORY_APP_KEY ? event.state : createHistoryState("home");

  if (entry.view === "detail" && entry.project) {
    showProjectPage(entry.project, { history: "none" });
    return;
  }

  if (entry.view === "results") {
    showResultsView({ history: "none" });
    return;
  }

  showHomeView({ history: "none", clearSearch: false });
}

function getProjectHistoryData(project) {
  return {
    source: getProjectSource(project),
    project_id: project.project_id || project.id,
    curseForgeId: project.curseForgeId,
    slug: project.slug,
    title: project.title || project.name || "Unknown mod",
    description: project.description || "",
    icon_url: project.icon_url || "",
    client_side: project.client_side || "unknown",
    server_side: project.server_side || "unknown",
    downloads: project.downloads ?? 0,
    followers: project.followers ?? 0,
    author: project.author || "",
  };
}

function showResultsView(options = {}) {
  const { history: historyMode = currentView === "results" ? "replace" : "push" } = options;

  activeDetailRequest += 1;
  currentView = "results";
  els.modDetail.hidden = true;
  els.results.hidden = false;
  setViewHistory("results", {}, historyMode);
}

function navigateBackFromDetail() {
  if (history.state?.app === HISTORY_APP_KEY && history.state.view === "detail" && history.length > 1) {
    history.back();
    return;
  }

  showResultsView();
}

function goHome(event) {
  event?.preventDefault();
  showHomeView();
}

function showHomeView(options = {}) {
  const { history: historyMode = currentView === "home" ? "replace" : "push", clearSearch = true } = options;

  activeDetailRequest += 1;
  currentView = "home";
  els.modDetail.hidden = true;
  els.results.hidden = true;
  if (clearSearch) els.searchInput.value = "";
  setStatus(`Home. Editing ${state.name}.`);
  setViewHistory("home", {}, historyMode);
}

async function showProjectPage(project, options = {}) {
  const { history: historyMode = "push" } = options;
  const requestId = ++activeDetailRequest;
  const historyProject = getProjectHistoryData(project);

  currentView = "detail";
  els.results.hidden = true;
  els.modDetail.hidden = false;
  els.modDetail.replaceChildren(emptyState(`Loading ${project.title}...`));
  setStatus(`Opening ${project.title} inside Packsplit...`);
  setViewHistory("detail", { project: historyProject }, historyMode);

  try {
    const details = await loadProjectDetails(project);
    if (requestId !== activeDetailRequest) return;
    renderProjectDetail(project, details);
    setStatus(`Viewing ${details.title || project.title}.`);
  } catch (error) {
    if (requestId !== activeDetailRequest) return;
    renderProjectDetail(project);
    setStatus(`Could not load full details for ${project.title}: ${error.message}`);
  }
}

async function loadProjectDetails(project) {
  if (getProjectSource(project) !== "curseforge") {
    return getJson(`${API_BASE}/project/${project.project_id}`);
  }

  const curseForgeId = getCurseForgeId(project);
  const [details, description] = await Promise.all([
    getJson(`${CURSEFORGE_API_BASE}/mods/${curseForgeId}`),
    getJson(`${CURSEFORGE_API_BASE}/mods/${curseForgeId}/description`).catch(() => ({ data: "" })),
  ]);

  return {
    ...normalizeCurseForgeProject(details.data),
    body: description.data || details.data?.summary || project.description,
  };
}

function renderProjectDetail(searchProject, details = {}) {
  const project = { ...searchProject, ...details };
  const detectedSide = inferSide(project.client_side, project.server_side);
  const added = state.mods.some((mod) => mod.projectId === getProjectKey(searchProject));
  const categories = [...new Set([...(project.categories ?? []), ...(project.loaders ?? [])])].slice(0, 10);
  const sourceLabel = getProjectSource(project) === "curseforge" ? "CurseForge" : "Modrinth";

  els.modDetail.replaceChildren();

  const backButton = document.createElement("button");
  backButton.className = "button";
  backButton.type = "button";
  backButton.textContent = "Back to results";
  backButton.addEventListener("click", navigateBackFromDetail);

  const addButton = document.createElement("button");
  addButton.className = "button primary";
  addButton.type = "button";
  addButton.textContent = added ? "Added" : "Add to pack";
  addButton.disabled = added;
  addButton.addEventListener("click", () => addProject(searchProject, addButton));

  const actions = document.createElement("div");
  actions.className = "detail-actions";
  actions.append(backButton, addButton);

  const header = document.createElement("div");
  header.className = "detail-header";
  header.innerHTML = `
    <img class="detail-icon" src="${escapeAttr(project.icon_url || searchProject.icon_url || "")}" alt="" />
    <div class="detail-title">
      <h2>${escapeHtml(project.title || searchProject.title)}</h2>
      <p>${escapeHtml(project.description || searchProject.description || "No description provided.")}</p>
    </div>
  `;

  const badgeRow = document.createElement("div");
  badgeRow.className = "badge-row";
  const badges = [
    sourceLabel,
    detectedSide,
    `${formatNumber(project.downloads)} downloads`,
    `${formatNumber(project.followers)} followers`,
    `client ${project.client_side || "unknown"}`,
    `server ${project.server_side || "unknown"}`,
    ...categories,
  ];

  for (const badge of badges.filter(Boolean)) {
    const element = document.createElement("span");
    element.className = "badge";
    element.textContent = badge;
    badgeRow.append(element);
  }

  const body = document.createElement("div");
  body.className = "detail-body";
  body.innerHTML = renderMarkdown(
    project.body?.trim() || project.description || searchProject.description || "No additional project description is available.",
  );

  els.modDetail.append(actions, header, badgeRow, body);
}

function renderMarkdown(value) {
  const lines = preprocessMarkdown(value).split("\n");
  const blocks = [];
  let paragraph = [];
  let list = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!list.length) return;
    blocks.push(`<ul>${list.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
    list = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length + 2;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (/^[-*_]{3,}$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push("<hr>");
      continue;
    }

    const listItem = line.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      list.push(listItem[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  return blocks.join("");
}

function preprocessMarkdown(value) {
  return decodeHtmlEntities(String(value))
    .replace(/\r/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "\n")
    .replace(/<\/?center[^>]*>/gi, "\n")
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const src = getHtmlAttribute(tag, "src");
      const alt = getHtmlAttribute(tag, "alt");
      return src ? `\n![${alt || "Project image"}](${src})\n` : "";
    })
    .replace(/<\/?[^>]+>/g, "");
}

function decodeHtmlEntities(value) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function renderInlineMarkdown(value) {
  let html = escapeHtml(value);

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/_([^_]+)_/g, "<em>$1</em>");
  html = html.replace(
    /\[!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)\]\((https?:\/\/[^)\s]+)\)/g,
    (_match, alt, imageUrl, linkUrl) => renderImageLink(alt, imageUrl, linkUrl),
  );
  html = html.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_match, alt, imageUrl) => renderImage(alt, imageUrl));
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label, url) => renderLink(label, url));

  return html;
}

function renderImageLink(alt, imageUrl, linkUrl) {
  imageUrl = decodeEscapedUrl(imageUrl);
  linkUrl = decodeEscapedUrl(linkUrl);
  if (!isSafeUrl(imageUrl) || !isSafeUrl(linkUrl)) return "";
  return `<a href="${escapeAttr(linkUrl)}" target="_blank" rel="noopener noreferrer"><img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(alt)}" loading="lazy"></a>`;
}

function renderImage(alt, imageUrl) {
  imageUrl = decodeEscapedUrl(imageUrl);
  if (!isSafeUrl(imageUrl)) return "";
  return `<img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(alt)}" loading="lazy">`;
}

function renderLink(label, url) {
  url = decodeEscapedUrl(url);
  if (!isSafeUrl(url)) return escapeHtml(label);
  return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function decodeEscapedUrl(url) {
  return String(url).replace(/&amp;/g, "&");
}

function getHtmlAttribute(tag, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(pattern);
  return match?.[2] || match?.[3] || match?.[4] || "";
}

function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

async function addProject(project, button) {
  button.disabled = true;
  button.textContent = "Resolving...";
  setStatus(`Resolving latest compatible file for ${project.title}...`);

  try {
    const { installed, alreadyInstalled } = await installProjectWithDependencies(project);

    await savePack(true);
    renderPack();
    button.textContent = "Added";

    const projectKey = getProjectKey(project);
    const dependencyCount = installed.filter((mod) => mod.projectId !== projectKey).length;
    const reusedCount = alreadyInstalled.filter((mod) => mod.projectId !== projectKey).length;
    const details = [];
    if (dependencyCount) details.push(`${dependencyCount} required dependenc${dependencyCount === 1 ? "y" : "ies"} installed`);
    if (reusedCount) details.push(`${reusedCount} already in the pack`);
    setStatus(`${project.title} was added to the pack${details.length ? `; ${details.join(", ")}.` : "."}`);
  } catch (error) {
    button.disabled = false;
    button.textContent = "Add to pack";
    setStatus(`Could not add ${project.title}: ${error.message}`);
  }
}

async function installProjectWithDependencies(project) {
  const installed = [];
  const alreadyInstalled = [];
  const visiting = new Set();
  const rootProjectId = getProjectKey(project);
  const rootMod = await installProjectEntry(project, {
    parent: null,
    installed,
    alreadyInstalled,
    visiting,
    autoInstalled: false,
  });

  await installRequiredDependencies(rootMod, {
    installed,
    alreadyInstalled,
    visiting,
    rootProjectId,
  });

  return { installed, alreadyInstalled };
}

async function installProjectEntry(project, context) {
  if (getProjectSource(project) === "curseforge") {
    return installCurseForgeProjectEntry(project, context);
  }

  let projectId = project.project_id || project.id;

  if (!projectId && !project.version_id) {
    throw new Error("Dependency does not include a Modrinth project or version ID.");
  }

  if (projectId) {
    const existing = state.mods.find((mod) => mod.projectId === projectId);
    if (existing) {
      linkParentToDependency(context.parent, existing);
      context.alreadyInstalled.push(existing);
      return existing;
    }
  }

  const version = project.version_id
    ? await getJson(`${API_BASE}/version/${project.version_id}`)
    : await resolveLatestVersion(projectId);
  projectId = projectId || version.project_id;

  const existing = state.mods.find((mod) => mod.projectId === projectId);
  if (existing) {
    linkParentToDependency(context.parent, existing);
    context.alreadyInstalled.push(existing);
    return existing;
  }

  if (context.visiting.has(projectId)) {
    throw new Error(`Circular dependency detected while installing ${project.title || projectId}.`);
  }

  context.visiting.add(projectId);
  try {
    const details = hasProjectMetadata(project) ? project : await getJson(`${API_BASE}/project/${projectId}`);
    const mod = createSavedMod(details, version, {
      autoInstalled: context.autoInstalled,
      requiredBy: context.parent ? [modReference(context.parent)] : [],
    });

    state.mods.push(mod);
    context.installed.push(mod);
    linkParentToDependency(context.parent, mod);

    return mod;
  } finally {
    context.visiting.delete(projectId);
  }
}

async function installCurseForgeProjectEntry(project, context) {
  let curseForgeId = getCurseForgeId(project);

  if (!curseForgeId) {
    throw new Error("Dependency does not include a CurseForge project ID.");
  }

  const projectId = createCurseForgeProjectId(curseForgeId);
  const existing = state.mods.find((mod) => mod.projectId === projectId);
  if (existing) {
    linkParentToDependency(context.parent, existing);
    context.alreadyInstalled.push(existing);
    return existing;
  }

  if (context.visiting.has(projectId)) {
    throw new Error(`Circular dependency detected while installing ${project.title || projectId}.`);
  }

  context.visiting.add(projectId);
  try {
    const details = hasProjectMetadata(project)
      ? project
      : normalizeCurseForgeProject((await getJson(`${CURSEFORGE_API_BASE}/mods/${curseForgeId}`)).data);
    curseForgeId = getCurseForgeId(details);
    const file = await resolveLatestCurseForgeFile(curseForgeId, state.minecraftVersion, state.loader);
    const mod = createSavedCurseForgeMod(details, file, {
      autoInstalled: context.autoInstalled,
      requiredBy: context.parent ? [modReference(context.parent)] : [],
    });

    state.mods.push(mod);
    context.installed.push(mod);
    linkParentToDependency(context.parent, mod);

    return mod;
  } finally {
    context.visiting.delete(projectId);
  }
}

function hasProjectMetadata(project) {
  return Boolean(project?.title && project?.slug && (project.client_side || project.server_side));
}

async function installRequiredDependencies(parentMod, context) {
  const requiredDependencies = getRequiredDependencies(parentMod.dependencies);

  for (const dependency of requiredDependencies) {
    if (!dependency.project_id && !dependency.version_id) continue;

    setStatus(`Installing required dependency for ${parentMod.title}...`);

    const dependencyMod = await installProjectEntry(
      {
        project_id: dependency.project_id,
        source: dependency.source,
        curseForgeId: dependency.curseForgeId,
        version_id: dependency.version_id,
        title: dependency.file_name || dependency.project_id || dependency.version_id,
      },
      {
        ...context,
        parent: parentMod,
        autoInstalled: true,
      },
    );

    if (dependencyMod.projectId !== context.rootProjectId) {
      await installRequiredDependencies(dependencyMod, context);
    }
  }
}

function createSavedMod(project, version, options = {}) {
  const file = version.files.find((candidate) => candidate.primary) ?? version.files[0];

  if (!file) {
    throw new Error("No downloadable file found for this version.");
  }

  const dependencies = version.dependencies ?? [];

  return {
    source: "modrinth",
    projectId: project.project_id || project.id || version.project_id,
    slug: project.slug,
    title: project.title || project.name || "Unknown mod",
    description: project.description || "",
    iconUrl: project.icon_url,
    clientSide: project.client_side || "unknown",
    serverSide: project.server_side || "unknown",
    side: inferSide(project.client_side, project.server_side),
    versionId: version.id,
    versionNumber: version.version_number,
    fileName: file.filename,
    downloadUrl: file.url,
    fileSize: file.size,
    sha1: file.hashes?.sha1 ?? null,
    dependencies,
    dependencyIds: getRequiredDependencyIds(dependencies),
    requiredBy: normalizeRequiredBy(options.requiredBy),
    autoInstalled: Boolean(options.autoInstalled),
  };
}

function createSavedCurseForgeMod(project, file, options = {}) {
  const curseForgeId = getCurseForgeId(project) || file.modId;
  const dependencies = normalizeCurseForgeDependencies(file.dependencies);

  return {
    source: "curseforge",
    projectId: createCurseForgeProjectId(curseForgeId),
    curseForgeId,
    slug: project.slug,
    title: project.title || project.name || "Unknown mod",
    description: project.description || project.summary || "",
    iconUrl: project.icon_url || project.logo?.thumbnailUrl || project.logo?.url || "",
    clientSide: project.client_side || "unknown",
    serverSide: project.server_side || "unknown",
    side: inferSide(project.client_side, project.server_side),
    versionId: `curseforge-file:${file.id}`,
    fileId: file.id,
    versionNumber: file.displayName || file.fileName,
    fileName: file.fileName,
    downloadUrl: `${CURSEFORGE_API_BASE.replace(/\/v1$/, "")}/download/${curseForgeId}/${file.id}`,
    fileSize: file.fileLength ?? file.fileSizeOnDisk ?? 0,
    sha1: getCurseForgeFileHash(file, 1),
    dependencies,
    dependencyIds: getRequiredDependencyIds(dependencies),
    requiredBy: normalizeRequiredBy(options.requiredBy),
    autoInstalled: Boolean(options.autoInstalled),
  };
}

function normalizeCurseForgeDependencies(dependencies) {
  return (Array.isArray(dependencies) ? dependencies : [])
    .filter((dependency) => dependency.relationType === 3 && dependency.modId)
    .map((dependency) => ({
      source: "curseforge",
      project_id: createCurseForgeProjectId(dependency.modId),
      curseForgeId: dependency.modId,
      dependency_type: "required",
    }));
}

function getCurseForgeFileHash(file, algo) {
  return (file.hashes ?? []).find((hash) => hash.algo === algo)?.value ?? null;
}

function getRequiredDependencies(dependencies) {
  return (Array.isArray(dependencies) ? dependencies : []).filter((dependency) => dependency.dependency_type === "required");
}

function getRequiredDependencyIds(dependencies) {
  return getRequiredDependencies(dependencies)
    .map((dependency) => dependency.project_id)
    .filter(Boolean);
}

function linkParentToDependency(parent, dependency) {
  if (!parent || !dependency || parent.projectId === dependency.projectId) return;

  parent.dependencyIds = [...new Set([...(parent.dependencyIds ?? []), dependency.projectId])];
  dependency.requiredBy = normalizeRequiredBy([...(dependency.requiredBy ?? []), modReference(parent)]);
}

function modReference(mod) {
  return {
    projectId: mod.projectId,
    title: mod.title,
  };
}

function normalizeRequiredBy(requiredBy) {
  const references = Array.isArray(requiredBy) ? requiredBy : [];
  const byProject = new Map();

  for (const reference of references) {
    if (!reference?.projectId) continue;
    byProject.set(reference.projectId, {
      projectId: reference.projectId,
      title: reference.title || "Unknown mod",
    });
  }

  return [...byProject.values()];
}

async function resolveLatestVersion(projectId) {
  return resolveLatestVersionFor(projectId, state.minecraftVersion, state.loader);
}

async function resolveLatestVersionFor(projectId, gameVersion, loader) {
  if (String(projectId).startsWith("curseforge:")) {
    return resolveLatestCurseForgeFile(getCurseForgeId({ projectId }), gameVersion, loader);
  }

  const params = new URLSearchParams({
    loaders: JSON.stringify([loader]),
    game_versions: JSON.stringify([gameVersion]),
    featured: "false",
  });
  const versions = await getJson(`${API_BASE}/project/${projectId}/version?${params}`);
  const listed = versions.filter((version) => version.status === "listed" || !version.status);
  const release = listed.find((version) => version.version_type === "release");
  const selected = release ?? listed[0] ?? versions[0];

  if (!selected) {
    throw new Error(`No ${loader} ${gameVersion} version found.`);
  }

  return selected;
}

async function resolveLatestCurseForgeFile(curseForgeId, gameVersion, loader) {
  const params = new URLSearchParams({
    gameVersion,
    pageSize: "50",
  });
  const loaderType = CURSEFORGE_LOADER_TYPES[loader];
  if (loaderType) params.set("modLoaderType", String(loaderType));

  const data = await getJson(`${CURSEFORGE_API_BASE}/mods/${curseForgeId}/files?${params}`);
  const files = (data.data ?? []).filter((file) => file.isAvailable !== false);
  const release = files.find((file) => file.releaseType === 1);
  const selected = release ?? files[0];

  if (!selected) {
    throw new Error(`No ${loader} ${gameVersion} file found.`);
  }

  return selected;
}

function applyVersionToMod(mod, version) {
  if (mod.source === "curseforge") {
    applyCurseForgeFileToMod(mod, version);
    return;
  }

  const file = version.files.find((candidate) => candidate.primary) ?? version.files[0];

  if (!file) {
    throw new Error("No downloadable file found for this version.");
  }

  mod.versionId = version.id;
  mod.versionNumber = version.version_number;
  mod.fileName = file.filename;
  mod.downloadUrl = file.url;
  mod.fileSize = file.size;
  mod.sha1 = file.hashes?.sha1 ?? null;
  mod.dependencies = version.dependencies ?? [];
  mod.dependencyIds = getRequiredDependencyIds(mod.dependencies);
  mod.compatibilityStatus = "compatible";
  mod.compatibilityMessage = "";
}

function applyCurseForgeFileToMod(mod, file) {
  mod.versionId = `curseforge-file:${file.id}`;
  mod.fileId = file.id;
  mod.versionNumber = file.displayName || file.fileName;
  mod.fileName = file.fileName;
  mod.downloadUrl = `${CURSEFORGE_API_BASE.replace(/\/v1$/, "")}/download/${mod.curseForgeId}/${file.id}`;
  mod.fileSize = file.fileLength ?? file.fileSizeOnDisk ?? 0;
  mod.sha1 = getCurseForgeFileHash(file, 1);
  mod.dependencies = normalizeCurseForgeDependencies(file.dependencies);
  mod.dependencyIds = getRequiredDependencyIds(mod.dependencies);
  mod.compatibilityStatus = "compatible";
  mod.compatibilityMessage = "";
}

function clearCompatibilityWarnings() {
  for (const mod of state.mods) {
    mod.compatibilityStatus = "";
    mod.compatibilityMessage = "";
  }
}

function markCompatibilityWarnings(updates, incompatible) {
  for (const { mod, version } of updates) {
    if (mod.versionId === getResolvedVersionId(mod, version)) {
      mod.compatibilityStatus = "compatible";
      mod.compatibilityMessage = "";
    } else {
      mod.compatibilityStatus = "needs-update";
      mod.compatibilityMessage = `A compatible ${state.minecraftVersion} file is available.`;
    }
  }

  for (const { mod, error } of incompatible) {
    mod.compatibilityStatus = "incompatible";
    mod.compatibilityMessage = error.message;
  }
}

function getResolvedVersionId(mod, version) {
  return mod.source === "curseforge" ? `curseforge-file:${version.id}` : version.id;
}

function setControlsDisabled(disabled) {
  for (const control of [els.minecraftVersion, els.loader, els.searchButton, els.importPack, els.exportClient, els.exportServer, els.clearPack]) {
    control.disabled = disabled;
    syncCustomSelect(control);
  }
}

function initializeCustomSelects() {
  document.querySelectorAll("select").forEach(setupCustomSelect);
}

function setupCustomSelect(select) {
  if (!(select instanceof HTMLSelectElement)) return;

  if (select.dataset.customSelect === "true") {
    syncCustomSelect(select);
    return;
  }

  select.dataset.customSelect = "true";
  select.classList.add("native-select");

  const shell = document.createElement("div");
  shell.className = "custom-select";

  const button = document.createElement("button");
  button.className = "custom-select-button";
  button.type = "button";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");

  const value = document.createElement("span");
  value.className = "custom-select-value";

  const chevron = document.createElement("span");
  chevron.className = "custom-select-chevron";
  chevron.setAttribute("aria-hidden", "true");

  const menu = document.createElement("div");
  menu.className = "custom-select-menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;

  button.append(value, chevron);
  select.after(shell);
  shell.append(select, button, menu);

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleCustomSelect(select);
  });
  button.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    event.preventDefault();
    openCustomSelect(select);
    focusCustomOption(select, event.key === "ArrowUp" ? -1 : 1);
  });

  syncCustomSelect(select);
}

function syncCustomSelect(select) {
  if (!(select instanceof HTMLSelectElement) || select.dataset.customSelect !== "true") return;

  const shell = select.closest(".custom-select");
  if (!shell) return;

  const button = shell.querySelector(".custom-select-button");
  const value = shell.querySelector(".custom-select-value");
  const menu = shell.querySelector(".custom-select-menu");
  const selectedOption = select.selectedOptions[0] ?? select.options[0];

  button.disabled = select.disabled;
  value.textContent = selectedOption?.textContent ?? "";
  menu.replaceChildren();

  for (const option of select.options) {
    const item = document.createElement("button");
    const isSelected = option.value === select.value;

    item.className = `custom-select-option${isSelected ? " selected" : ""}`;
    item.type = "button";
    item.role = "option";
    item.ariaSelected = String(isSelected);
    item.textContent = option.textContent;
    item.disabled = option.disabled;
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      if (select.value !== option.value) {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      closeCustomSelect(select);
      syncCustomSelect(select);
      button.focus();
    });
    item.addEventListener("keydown", (event) => handleCustomOptionKeydown(event, select));

    menu.append(item);
  }
}

function toggleCustomSelect(select) {
  const shell = select.closest(".custom-select");
  const button = shell?.querySelector(".custom-select-button");
  const menu = shell?.querySelector(".custom-select-menu");

  if (!shell || !button || !menu || select.disabled) return;

  if (activeCustomSelect && activeCustomSelect !== select) closeCustomSelect(activeCustomSelect);

  const willOpen = menu.hidden;
  if (willOpen) {
    openCustomSelect(select);
  } else {
    closeCustomSelect(select);
  }
}

function openCustomSelect(select) {
  const shell = select.closest(".custom-select");
  const button = shell?.querySelector(".custom-select-button");
  const menu = shell?.querySelector(".custom-select-menu");

  if (!shell || !button || !menu || select.disabled) return;

  if (activeCustomSelect && activeCustomSelect !== select) closeCustomSelect(activeCustomSelect);

  syncCustomSelect(select);
  menu.hidden = false;
  shell.classList.add("open");
  button.setAttribute("aria-expanded", "true");
  activeCustomSelect = select;
  menu.querySelector(".custom-select-option.selected")?.scrollIntoView({ block: "nearest" });
}

function closeCustomSelect(select) {
  const shell = select?.closest(".custom-select");
  const button = shell?.querySelector(".custom-select-button");
  const menu = shell?.querySelector(".custom-select-menu");

  if (!shell || !button || !menu) return;

  menu.hidden = true;
  shell.classList.remove("open");
  button.setAttribute("aria-expanded", "false");
  if (activeCustomSelect === select) activeCustomSelect = null;
}

function handleCustomOptionKeydown(event, select) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeCustomSelect(select);
    select.closest(".custom-select")?.querySelector(".custom-select-button")?.focus();
    return;
  }

  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

  event.preventDefault();
  if (event.key === "Home") {
    focusCustomOption(select, "first");
  } else if (event.key === "End") {
    focusCustomOption(select, "last");
  } else {
    focusCustomOption(select, event.key === "ArrowDown" ? 1 : -1);
  }
}

function focusCustomOption(select, direction) {
  const options = [...(select.closest(".custom-select")?.querySelectorAll(".custom-select-option:not(:disabled)") ?? [])];
  if (!options.length) return;

  if (direction === "first") {
    options[0].focus();
    return;
  }

  if (direction === "last") {
    options.at(-1).focus();
    return;
  }

  const activeIndex = options.indexOf(document.activeElement);
  const selectedIndex = options.findIndex((option) => option.classList.contains("selected"));
  const startIndex = activeIndex >= 0 ? activeIndex : selectedIndex;
  const nextIndex = Math.max(0, Math.min(options.length - 1, startIndex + direction));
  options[nextIndex].focus();
}

function handleDocumentClick(event) {
  if (activeCustomSelect && !event.target.closest(".custom-select")) {
    closeCustomSelect(activeCustomSelect);
  }
}

function handleDocumentKeydown(event) {
  if (event.key !== "Escape") return;

  if (activeCustomSelect) {
    closeCustomSelect(activeCustomSelect);
    return;
  }

  if (dialogState) {
    closeAppDialog(false);
  }
}

function appAlert(message, options = {}) {
  return showAppDialog({
    title: options.title || "Notice",
    message,
    confirmText: options.confirmText || "OK",
    alertOnly: true,
  });
}

function appConfirm(message, options = {}) {
  return showAppDialog({
    title: options.title || "Confirm action",
    message,
    confirmText: options.confirmText || "Continue",
    cancelText: options.cancelText || "Cancel",
    danger: Boolean(options.danger),
  });
}

function showAppDialog({ title, message, confirmText, cancelText, danger = false, alertOnly = false }) {
  ensureAppDialog();

  const overlay = document.querySelector("#appDialog");
  const panel = overlay.querySelector(".app-dialog-panel");
  const titleEl = overlay.querySelector("#appDialogTitle");
  const messageEl = overlay.querySelector("#appDialogMessage");
  const cancelButton = overlay.querySelector("[data-dialog-cancel]");
  const confirmButton = overlay.querySelector("[data-dialog-confirm]");

  titleEl.textContent = title;
  messageEl.textContent = message;
  cancelButton.hidden = alertOnly;
  cancelButton.textContent = cancelText || "Cancel";
  confirmButton.textContent = confirmText || "OK";
  confirmButton.className = `button primary${danger ? " dialog-danger" : ""}`;
  overlay.hidden = false;

  return new Promise((resolve) => {
    dialogState = {
      resolve,
      previousFocus: document.activeElement,
    };

    requestAnimationFrame(() => {
      panel.focus();
      confirmButton.focus();
    });
  });
}

function ensureAppDialog() {
  if (document.querySelector("#appDialog")) return;

  const overlay = document.createElement("div");
  overlay.id = "appDialog";
  overlay.className = "app-dialog";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="app-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="appDialogTitle" aria-describedby="appDialogMessage" tabindex="-1">
      <div class="app-dialog-content">
        <h2 id="appDialogTitle"></h2>
        <p id="appDialogMessage"></p>
      </div>
      <div class="app-dialog-actions">
        <button class="button" type="button" data-dialog-cancel>Cancel</button>
        <button class="button primary" type="button" data-dialog-confirm>OK</button>
      </div>
    </div>
  `;

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeAppDialog(false);
  });
  overlay.querySelector("[data-dialog-cancel]").addEventListener("click", () => closeAppDialog(false));
  overlay.querySelector("[data-dialog-confirm]").addEventListener("click", () => closeAppDialog(true));
  document.body.append(overlay);
}

function closeAppDialog(value) {
  const overlay = document.querySelector("#appDialog");
  if (!overlay || !dialogState) return;

  const { resolve, previousFocus } = dialogState;
  dialogState = null;
  overlay.hidden = true;
  resolve(value);

  if (previousFocus instanceof HTMLElement) {
    previousFocus.focus();
  }
}

function renderPack() {
  const groups = {
    client: state.mods.filter((mod) => mod.side === "client"),
    both: state.mods.filter((mod) => mod.side === "both"),
    server: state.mods.filter((mod) => mod.side === "server"),
  };

  renderLane(els.clientMods, groups.client);
  renderLane(els.bothMods, groups.both);
  renderLane(els.serverMods, groups.server);

  els.clientCount.textContent = String(groups.client.length);
  els.bothCount.textContent = String(groups.both.length);
  els.serverCount.textContent = String(groups.server.length);
}

function renderLane(container, mods) {
  container.replaceChildren();

  if (mods.length === 0) {
    container.append(emptyState("No mods here yet."));
    return;
  }

  for (const mod of mods) {
    const card = document.createElement("article");
    card.className = "mod-card";
    card.tabIndex = 0;
    card.role = "button";
    card.title = `View ${mod.title}`;

    card.innerHTML = `
      <div class="card-title">
        <img class="icon" src="${escapeAttr(mod.iconUrl || "")}" alt="" />
        <div class="title-stack">
          <strong>${escapeHtml(mod.title)}</strong>
          <span>${escapeHtml(mod.fileName)}</span>
        </div>
      </div>
      <div class="meta">${escapeHtml(mod.versionNumber)} &middot; client ${escapeHtml(mod.clientSide)} &middot; server ${escapeHtml(mod.serverSide)}</div>
    `;
    card.addEventListener("click", (event) => {
      if (event.target.closest(".mod-toolbar")) return;
      showProjectPage(projectFromSavedMod(mod));
    });
    card.addEventListener("keydown", (event) => {
      if (event.target.closest(".mod-toolbar")) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showProjectPage(projectFromSavedMod(mod));
      }
    });

    if (mod.compatibilityStatus && mod.compatibilityStatus !== "compatible") {
      const warning = document.createElement("div");
      warning.className = `compat-warning ${mod.compatibilityStatus}`;
      warning.textContent = mod.compatibilityMessage || "This mod needs attention for the selected version.";
      card.append(warning);
    }

    const dependencyNote = getDependencyNote(mod);
    if (dependencyNote) {
      const note = document.createElement("div");
      note.className = "dependency-note";
      note.textContent = dependencyNote;
      card.append(note);
    }

    const toolbar = document.createElement("div");
    toolbar.className = "mod-toolbar";

    const sideSelect = document.createElement("select");
    for (const side of ["client", "both", "server"]) {
      const option = document.createElement("option");
      option.value = side;
      option.textContent = side;
      option.selected = mod.side === side;
      sideSelect.append(option);
    }
    sideSelect.addEventListener("click", (event) => event.stopPropagation());
    sideSelect.addEventListener("change", () => {
      mod.side = sideSelect.value;
      savePack();
      renderPack();
    });

    const removeButton = document.createElement("button");
    removeButton.className = "button danger";
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      await removeMod(mod);
    });

    toolbar.append(sideSelect, removeButton);
    setupCustomSelect(sideSelect);
    card.append(toolbar);
    container.append(card);
  }
}

async function removeMod(mod) {
  const dependents = findDependents(mod);

  if (dependents.length) {
    const names = formatModList(dependents);
    const message = `${mod.title} is required by ${names}. Removing it may break those mods.\n\nRemove it anyway?`;
    if (!(await appConfirm(message, {
      title: "Remove required mod?",
      confirmText: "Remove mod",
      danger: true,
    }))) {
      setStatus(`${mod.title} was kept because other mods still need it.`);
      return;
    }
  } else {
    const unusedDependencies = findUnusedAutoDependencies(mod);

    if (unusedDependencies.length) {
      const names = formatModList(unusedDependencies);
      await appAlert(`${mod.title} installed these dependencies, which may no longer be needed: ${names}. They will stay in the pack unless you remove them too.`, {
        title: "Dependencies left in pack",
      });
    }
  }

  state.mods = state.mods.filter((candidate) => candidate.projectId !== mod.projectId);

  for (const candidate of state.mods) {
    candidate.requiredBy = normalizeRequiredBy((candidate.requiredBy ?? []).filter((reference) => reference.projectId !== mod.projectId));
  }

  await savePack(true);
  renderPack();
  setStatus(`${mod.title} was removed from the pack.`);
}

function findDependents(mod) {
  return state.mods.filter((candidate) => {
    if (candidate.projectId === mod.projectId) return false;
    return (candidate.dependencyIds ?? []).includes(mod.projectId) || (mod.requiredBy ?? []).some((reference) => reference.projectId === candidate.projectId);
  });
}

function findUnusedAutoDependencies(mod) {
  const dependencyIds = new Set(mod.dependencyIds ?? []);

  return state.mods.filter((candidate) => {
    if (!candidate.autoInstalled || !dependencyIds.has(candidate.projectId)) return false;
    return findDependents(candidate).every((dependent) => dependent.projectId === mod.projectId);
  });
}

function getDependencyNote(mod) {
  const requiredBy = normalizeRequiredBy(mod.requiredBy);
  if (requiredBy.length) return `Required by ${formatModList(requiredBy)}.`;

  const dependencyCount = (mod.dependencyIds ?? []).length;
  if (dependencyCount) return `Needs ${dependencyCount} required dependenc${dependencyCount === 1 ? "y" : "ies"}.`;

  return "";
}

function formatModList(mods) {
  return mods
    .map((mod) => mod.title)
    .filter(Boolean)
    .slice(0, 4)
    .join(", ") + (mods.length > 4 ? `, and ${mods.length - 4} more` : "");
}

function projectFromSavedMod(mod) {
  return {
    source: mod.source || "modrinth",
    project_id: mod.projectId,
    curseForgeId: mod.curseForgeId,
    slug: mod.slug,
    title: mod.title,
    description: mod.description,
    icon_url: mod.iconUrl,
    client_side: mod.clientSide,
    server_side: mod.serverSide,
  };
}

function inferSide(clientSide, serverSide) {
  const clientRequired = clientSide === "required";
  const serverRequired = serverSide === "required";
  const clientUnsupported = clientSide === "unsupported";
  const serverUnsupported = serverSide === "unsupported";

  if (clientRequired && serverUnsupported) return "client";
  if (serverRequired && clientUnsupported) return "server";
  if (clientRequired && serverRequired) return "both";
  if (clientRequired && serverSide === "optional") return "client";
  if (serverRequired && clientSide === "optional") return "server";
  return "both";
}

async function exportSide(side) {
  await syncSettings();

  const mods =
    side === "client"
      ? state.mods.filter((mod) => mod.side === "client" || mod.side === "both")
      : state.mods.filter((mod) => mod.side === "server" || mod.side === "both");
  const unresolved = mods.filter((mod) => mod.compatibilityStatus && mod.compatibilityStatus !== "compatible");

  if (unresolved.length) {
    const message = `${unresolved.length} ${side} export mod${unresolved.length === 1 ? "" : "s"} still need compatibility attention. Update or remove them before exporting.`;
    await appAlert(message, {
      title: "Export needs attention",
    });
    setStatus(message);
    return;
  }

  if (!mods.length) {
    setStatus(`There are no ${side} mods to export.`);
    return;
  }

  setControlsDisabled(true);

  try {
    setStatus(`Preparing ${mods.length} ${side} mod jar${mods.length === 1 ? "" : "s"}...`);

    const files = [];
    const usedPaths = new Set();

    for (let index = 0; index < mods.length; index += 1) {
      const mod = mods[index];
      const blob = await getModJarBlob(mod, {
        onDownloadStart: () => setStatus(`Downloading ${mod.title} (${index + 1}/${mods.length})...`),
        onCacheHit: () => setStatus(`Using cached ${mod.title} (${index + 1}/${mods.length})...`),
      });

      files.push({
        path: createUniqueZipPath(`mods/${sanitizeFileName(mod.fileName || `${mod.slug || mod.projectId}.jar`)}`, usedPaths),
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    }

    const manifest = {
      name: state.name,
      side,
      minecraftVersion: state.minecraftVersion,
      loader: state.loader,
      exportedAt: new Date().toISOString(),
      server: side === "server" ? createServerManifest() : undefined,
      modCount: mods.length,
      mods: mods.map((mod) => ({
        source: mod.source || "modrinth",
        title: mod.title,
        projectId: mod.projectId,
        curseForgeId: mod.curseForgeId,
        versionId: mod.versionId,
        fileId: mod.fileId,
        fileName: mod.fileName,
        downloadUrl: mod.downloadUrl,
        sha1: mod.sha1,
        side: mod.side,
        dependencies: mod.dependencies,
        dependencyIds: mod.dependencyIds ?? [],
        requiredBy: mod.requiredBy ?? [],
        autoInstalled: Boolean(mod.autoInstalled),
      })),
    };

    if (side === "server") {
      setStatus(`Adding ${state.loader} server runtime files...`);
      const serverFiles = await createServerRuntimeFiles();

      for (const file of serverFiles) {
        files.push({
          path: createUniqueZipPath(file.path, usedPaths),
          data: file.data,
        });
      }
    }

    files.push({
      path: "manifest.json",
      data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
    });

    if (side === "server" && "CompressionStream" in window) {
      setStatus("Creating server tar.gz...");
      downloadBlob(`${slugify(state.name)}-server.tar.gz`, await createTarGzBlob(files), "application/gzip");
      setStatus(`Exported ${mods.length} server mod jar${mods.length === 1 ? "" : "s"} to a tar.gz.`);
    } else {
      setStatus(`Creating ${side} zip...`);
      downloadBlob(`${slugify(state.name)}-${side}.zip`, createZipBlob(files), "application/zip");
      setStatus(`Exported ${mods.length} ${side} mod jar${mods.length === 1 ? "" : "s"} to a zip.`);
    }
    updateDatabaseSizeCounter();
  } catch (error) {
    setStatus(`Export failed: ${error.message}`);
  } finally {
    setControlsDisabled(false);
  }
}

function createServerManifest() {
  return {
    loader: state.loader,
    minecraftVersion: state.minecraftVersion,
    startup: "bash start.sh",
    memory: {
      source: "Pterodactyl SERVER_MEMORY",
      fallbackMb: DEFAULT_SERVER_MEMORY_MB,
    },
  };
}

async function createServerRuntimeFiles() {
  const textFiles = [
    {
      path: "start.sh",
      data: encodeText(createUnixStartScript()),
    },
    {
      path: "start.bat",
      data: encodeText(createWindowsStartScript()),
    },
    {
      path: "server.properties",
      data: encodeText(createServerProperties()),
    },
    {
      path: "eula.txt",
      data: encodeText("# Change to true after you accept the Minecraft EULA: https://aka.ms/MinecraftEULA\neula=false\n"),
    },
    {
      path: "README-PTERODACTYL.txt",
      data: encodeText(createPterodactylReadme()),
    },
  ];

  const loaderFiles = await createLoaderRuntimeFiles();
  return [...textFiles, ...loaderFiles];
}

async function createLoaderRuntimeFiles() {
  if (state.loader === "fabric") {
    const runtime = await resolveFabricRuntime();
    const serverJar = await fetchBinary(runtime.serverJarUrl);

    return [
      { path: "server.jar", data: serverJar },
      { path: "loader-runtime.json", data: encodeText(JSON.stringify(runtime, null, 2)) },
    ];
  }

  if (state.loader === "forge") {
    return [
      { path: "loader-runtime.json", data: encodeText(JSON.stringify(createForgeRuntime(), null, 2)) },
    ];
  }

  if (state.loader === "neoforge") {
    return [
      { path: "loader-runtime.json", data: encodeText(JSON.stringify(createNeoForgeRuntime(), null, 2)) },
    ];
  }

  if (state.loader === "quilt") {
    const runtime = await resolveQuiltRuntime();
    const installer = await fetchBinary(runtime.installerUrl);

    return [
      { path: "loaders/quilt-installer.jar", data: installer },
      { path: "loader-runtime.json", data: encodeText(JSON.stringify(runtime, null, 2)) },
    ];
  }

  throw new Error(`${state.loader} server runtime packaging is not available yet.`);
}

async function resolveFabricRuntime() {
  const [loaders, installers] = await Promise.all([
    getJson(`${FABRIC_META_BASE}/versions/loader/${state.minecraftVersion}`),
    getJson(`${FABRIC_META_BASE}/versions/installer`),
  ]);
  const loader = loaders.find((entry) => entry.loader?.stable) ?? loaders[0];
  const installer = installers.find((entry) => entry.stable) ?? installers[0];

  if (!loader?.loader?.version || !installer?.version) {
    throw new Error(`No Fabric server runtime found for Minecraft ${state.minecraftVersion}.`);
  }

  return {
    loader: "fabric",
    minecraftVersion: state.minecraftVersion,
    loaderVersion: loader.loader.version,
    installerVersion: installer.version,
    serverJarUrl: `${FABRIC_META_BASE}/versions/loader/${state.minecraftVersion}/${loader.loader.version}/${installer.version}/server/jar`,
  };
}

async function resolveForgeRuntime() {
  const versions = parseMavenMetadataVersions(await getText(`${FORGE_MAVEN_BASE}/maven-metadata.xml`));
  const version = pickLatestMavenVersion(versions, `${state.minecraftVersion}-`);

  if (!version) {
    throw new Error(`No Forge installer found for Minecraft ${state.minecraftVersion}.`);
  }

  return {
    loader: "forge",
    minecraftVersion: state.minecraftVersion,
    loaderVersion: version.slice(`${state.minecraftVersion}-`.length),
    installerVersion: version,
    installerUrl: `${FORGE_MAVEN_BASE}/${version}/forge-${version}-installer.jar`,
  };
}

function createForgeRuntime() {
  return {
    loader: "forge",
    minecraftVersion: state.minecraftVersion,
    installer: "downloaded-on-first-start",
    metadataUrl: `${FORGE_MAVEN_BASE}/maven-metadata.xml`,
  };
}

async function resolveNeoForgeRuntime() {
  const versions = parseMavenMetadataVersions(await getText(`${NEOFORGE_MAVEN_BASE}/maven-metadata.xml`));
  const prefix = getNeoForgeVersionPrefix(state.minecraftVersion);
  const version = pickLatestMavenVersion(versions, prefix);

  if (!version) {
    throw new Error(`No NeoForge installer found for Minecraft ${state.minecraftVersion}.`);
  }

  return {
    loader: "neoforge",
    minecraftVersion: state.minecraftVersion,
    installerVersion: version,
    installerUrl: `${NEOFORGE_MAVEN_BASE}/${version}/neoforge-${version}-installer.jar`,
  };
}

function createNeoForgeRuntime() {
  return {
    loader: "neoforge",
    minecraftVersion: state.minecraftVersion,
    installer: "downloaded-on-first-start",
    metadataUrl: `${NEOFORGE_MAVEN_BASE}/maven-metadata.xml`,
    versionPrefix: getNeoForgeVersionPrefix(state.minecraftVersion),
  };
}

async function resolveQuiltRuntime() {
  const versions = parseMavenMetadataVersions(await getText(`${QUILT_INSTALLER_MAVEN_BASE}/maven-metadata.xml`));
  const version = pickLatestMavenVersion(versions, "");

  if (!version) {
    throw new Error("No Quilt installer found.");
  }

  return {
    loader: "quilt",
    minecraftVersion: state.minecraftVersion,
    installerVersion: version,
    installerUrl: `${QUILT_INSTALLER_MAVEN_BASE}/${version}/quilt-installer-${version}.jar`,
  };
}

function getNeoForgeVersionPrefix(minecraftVersion) {
  const parts = parseMinecraftVersion(minecraftVersion);

  if (parts[1] === 20 && parts[2] === 1) return "47.1.";
  return `${parts[1]}.${parts[2] ?? 0}.`;
}

function parseMavenMetadataVersions(xml) {
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((match) => match[1]);
}

function pickLatestMavenVersion(versions, prefix) {
  const candidates = versions.filter((version) => version.startsWith(prefix));
  candidates.sort(compareMavenVersionsDesc);
  return candidates[0] ?? null;
}

function compareMavenVersionsDesc(a, b) {
  const aParts = splitMavenVersion(a);
  const bParts = splitMavenVersion(b);
  const maxLength = Math.max(aParts.length, bParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const aPart = aParts[index] ?? 0;
    const bPart = bParts[index] ?? 0;

    if (typeof aPart === "number" && typeof bPart === "number" && aPart !== bPart) {
      return bPart - aPart;
    }

    const difference = String(bPart).localeCompare(String(aPart), undefined, { numeric: true });
    if (difference !== 0) return difference;
  }

  return String(b).localeCompare(String(a));
}

function splitMavenVersion(version) {
  return String(version)
    .split(/[.-]/)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

async function getText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function fetchBinary(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function createUnixStartScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

LOADER="${state.loader}"
MINECRAFT_VERSION="${state.minecraftVersion}"
NEOFORGE_VERSION_PREFIX="${getNeoForgeVersionPrefix(state.minecraftVersion)}"
MEMORY_MB="\${SERVER_MEMORY:-\${MAX_MEMORY:-${DEFAULT_SERVER_MEMORY_MB}}}"
JAVA_EXTRA_ARGS="\${JAVA_EXTRA_ARGS:-}"

write_jvm_args() {
  {
    echo "-Xms128M"
    echo "-Xmx\${MEMORY_MB}M"
    if [ -n "\${JAVA_EXTRA_ARGS}" ]; then
      echo "\${JAVA_EXTRA_ARGS}"
    fi
  } > user_jvm_args.txt
}

fetch_text() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$1"
  else
    echo "curl or wget is required to download loader files on first start." >&2
    exit 1
  fi
}

download_file() {
  mkdir -p "$(dirname "$2")"
  if command -v curl >/dev/null 2>&1; then
    curl -fL -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$2" "$1"
  else
    echo "curl or wget is required to download loader files on first start." >&2
    exit 1
  fi
}

latest_maven_version() {
  fetch_text "$1/maven-metadata.xml" |
    sed -n 's:.*<version>\\(.*\\)</version>.*:\\1:p' |
    grep "^$2" |
    sort -V |
    tail -n 1
}

ensure_forge_installer() {
  if [ -f loaders/forge-installer.jar ]; then
    return
  fi

  FORGE_BASE="${FORGE_MAVEN_BASE}"
  FORGE_VERSION="$(latest_maven_version "\${FORGE_BASE}" "\${MINECRAFT_VERSION}-")"

  if [ -z "\${FORGE_VERSION}" ]; then
    echo "No Forge version found for Minecraft \${MINECRAFT_VERSION}." >&2
    exit 1
  fi

  download_file "\${FORGE_BASE}/\${FORGE_VERSION}/forge-\${FORGE_VERSION}-installer.jar" loaders/forge-installer.jar
}

ensure_neoforge_installer() {
  if [ -f loaders/neoforge-installer.jar ]; then
    return
  fi

  NEOFORGE_BASE="${NEOFORGE_MAVEN_BASE}"
  NEOFORGE_VERSION="$(latest_maven_version "\${NEOFORGE_BASE}" "\${NEOFORGE_VERSION_PREFIX}")"

  if [ -z "\${NEOFORGE_VERSION}" ]; then
    echo "No NeoForge version found for Minecraft \${MINECRAFT_VERSION}." >&2
    exit 1
  fi

  download_file "\${NEOFORGE_BASE}/\${NEOFORGE_VERSION}/neoforge-\${NEOFORGE_VERSION}-installer.jar" loaders/neoforge-installer.jar
}

if [ ! -f eula.txt ]; then
  echo "eula=false" > eula.txt
fi

case "\${LOADER}" in
  fabric)
    exec java -Xms128M -Xmx"\${MEMORY_MB}"M \${JAVA_EXTRA_ARGS} -jar server.jar nogui
    ;;
  forge)
    write_jvm_args
    if [ ! -f run.sh ] && [ ! -f unix_args.txt ]; then
      ensure_forge_installer
      java -jar loaders/forge-installer.jar --installServer
    fi
    if [ -f run.sh ]; then
      chmod +x run.sh
      exec ./run.sh nogui
    fi
    SERVER_JAR="$(find . -maxdepth 1 -type f -name 'forge-*.jar' ! -name '*installer*' | sort -V | tail -n 1)"
    exec java -Xms128M -Xmx"\${MEMORY_MB}"M \${JAVA_EXTRA_ARGS} -jar "\${SERVER_JAR}" nogui
    ;;
  neoforge)
    write_jvm_args
    if [ ! -f run.sh ] && [ ! -f unix_args.txt ]; then
      ensure_neoforge_installer
      java -jar loaders/neoforge-installer.jar --installServer
    fi
    chmod +x run.sh
    exec ./run.sh nogui
    ;;
  quilt)
    if [ ! -f quilt-server-launch.jar ]; then
      java -jar loaders/quilt-installer.jar install server "\${MINECRAFT_VERSION}" --download-server --install-dir=.
    fi
    exec java -Xms128M -Xmx"\${MEMORY_MB}"M \${JAVA_EXTRA_ARGS} -jar quilt-server-launch.jar nogui
    ;;
  *)
    echo "Unsupported loader: \${LOADER}" >&2
    exit 1
    ;;
esac
`;
}

function createWindowsStartScript() {
  return `@echo off
setlocal
set LOADER=${state.loader}
if "%SERVER_MEMORY%"=="" set SERVER_MEMORY=${DEFAULT_SERVER_MEMORY_MB}
if not exist eula.txt echo eula=false>eula.txt

if "%LOADER%"=="fabric" (
  java -Xms128M -Xmx%SERVER_MEMORY%M %JAVA_EXTRA_ARGS% -jar server.jar nogui
  exit /b %ERRORLEVEL%
)

if "%LOADER%"=="forge" (
  if not exist loaders\\forge-installer.jar (
    echo Forge installer is downloaded automatically by start.sh on Linux/Pterodactyl.
    echo Run bash start.sh on the server, or place forge-installer.jar in loaders first.
    exit /b 1
  )
  java -jar loaders\\forge-installer.jar --installServer
  if exist run.bat (
    call run.bat nogui
  ) else (
    for %%F in (forge-*.jar) do java -Xms128M -Xmx%SERVER_MEMORY%M %JAVA_EXTRA_ARGS% -jar "%%F" nogui
  )
  exit /b %ERRORLEVEL%
)

if "%LOADER%"=="neoforge" (
  if not exist loaders\\neoforge-installer.jar (
    echo NeoForge installer is downloaded automatically by start.sh on Linux/Pterodactyl.
    echo Run bash start.sh on the server, or place neoforge-installer.jar in loaders first.
    exit /b 1
  )
  java -jar loaders\\neoforge-installer.jar --installServer
  call run.bat nogui
  exit /b %ERRORLEVEL%
)

if "%LOADER%"=="quilt" (
  if not exist quilt-server-launch.jar java -jar loaders\\quilt-installer.jar install server ${state.minecraftVersion} --download-server --install-dir=.
  java -Xms128M -Xmx%SERVER_MEMORY%M %JAVA_EXTRA_ARGS% -jar quilt-server-launch.jar nogui
  exit /b %ERRORLEVEL%
)

echo Unsupported loader: %LOADER%
exit /b 1
`;
}

function createServerProperties() {
  return `# Generated by Packsplit
motd=${state.name.replace(/[\\r\\n=]/g, " ")}
enable-command-block=false
online-mode=true
server-port=25565
`;
}

function createPterodactylReadme() {
  return `Packsplit Pterodactyl server export

Upload and extract this zip into the server root.

Recommended Pterodactyl startup command:
bash start.sh

Memory:
start.sh reads Pterodactyl's SERVER_MEMORY environment variable and passes it to Java as -Xmx. If the panel does not provide SERVER_MEMORY, it uses ${DEFAULT_SERVER_MEMORY_MB} MB.

First run:
Forge and NeoForge download the official installer jar on first boot, run it to create the loader libraries and run scripts, then start the server. Fabric starts from the bundled server.jar. Quilt uses the bundled Quilt installer on first boot.

EULA:
Set eula=true in eula.txt only after you accept the Minecraft EULA.
`;
}

function encodeText(value) {
  return new TextEncoder().encode(value);
}

function clearPack() {
  if (!state.mods.length) return;
  state.mods = [];
  savePack(true);
  renderPack();
  setStatus("Pack cleared.");
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function postJson(url, data) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.json();
}

function setStatus(message) {
  els.status.textContent = message;
}

function emptyState(message) {
  const element = document.createElement("div");
  element.className = "empty";
  element.textContent = message;
  return element;
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  downloadBlob(filename, blob, "application/json");
}

function downloadBlob(filename, blob, type = "application/octet-stream") {
  const downloadBlob = blob.type === type ? blob : new Blob([blob], { type });
  const url = URL.createObjectURL(downloadBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function readZipFile(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const entries = parseZipEntries(data);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));

  return {
    entries,
    has(path) {
      return byName.has(path);
    },
    async readText(path) {
      return new TextDecoder().decode(await this.readBinary(path));
    },
    async readBinary(path) {
      const entry = byName.get(path);
      if (!entry) throw new Error(`${path} was not found in the archive.`);
      return inflateZipEntry(data, entry);
    },
  };
}

function parseZipEntries(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const endOffset = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  const entries = [];
  let offset = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("The zip central directory is invalid.");
    }

    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nameBytes = data.slice(offset + 46, offset + 46 + nameLength);
    const name = new TextDecoder(flags & 0x0800 ? "utf-8" : undefined).decode(nameBytes).replace(/\\/g, "/");

    if (!name.endsWith("/")) {
      entries.push({
        name,
        method,
        compressedSize,
        uncompressedSize,
        localOffset,
      });
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(view) {
  const minimumOffset = Math.max(0, view.byteLength - 0xffff - 22);

  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }

  throw new Error("This does not look like a valid zip archive.");
}

async function inflateZipEntry(zipData, entry) {
  const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength);
  const localOffset = entry.localOffset;

  if (view.getUint32(localOffset, true) !== 0x04034b50) {
    throw new Error(`The zip entry ${entry.name} is invalid.`);
  }

  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const compressed = zipData.slice(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) return compressed;
  if (entry.method !== 8) {
    throw new Error(`${entry.name} uses an unsupported zip compression method.`);
  }

  if (!("DecompressionStream" in window)) {
    throw new Error("This browser cannot read compressed zip files. Try importing from a current Chromium, Edge, or Firefox build.");
  }

  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const inflated = new Uint8Array(await new Response(stream).arrayBuffer());

  if (entry.uncompressedSize && inflated.length !== entry.uncompressedSize) {
    throw new Error(`${entry.name} did not decompress cleanly.`);
  }

  return inflated;
}

async function getModJarBlob(mod, callbacks = {}) {
  const cacheKey = createModFileCacheKey(mod);
  const cached = await getCachedModFile(cacheKey);

  if (cached?.blob) {
    callbacks.onCacheHit?.();
    return cached.blob;
  }

  if (!mod.downloadUrl) {
    throw new Error(`${mod.title} does not have a download URL.`);
  }

  callbacks.onDownloadStart?.();

  const response = await fetch(mod.downloadUrl);
  if (!response.ok) {
    throw new Error(`Could not download ${mod.title}: ${response.status} ${response.statusText}`);
  }

  const blob = await response.blob();

  try {
    await putCachedModFile({
      key: cacheKey,
      projectId: mod.projectId,
      versionId: mod.versionId,
      sha1: mod.sha1,
      fileName: mod.fileName,
      size: blob.size,
      blob,
      cachedAt: new Date().toISOString(),
    });
    updateDatabaseSizeCounter();
  } catch {
    // Export should still work if quota, privacy mode, or browser policy blocks jar caching.
  }

  return blob;
}

function createModFileCacheKey(mod) {
  return mod.sha1 || mod.versionId || `${mod.projectId}:${mod.fileName}`;
}

async function createTarGzBlob(files) {
  const tarBlob = createTarBlob(files);
  const stream = tarBlob.stream().pipeThrough(new CompressionStream("gzip"));
  return new Blob([await new Response(stream).arrayBuffer()], { type: "application/gzip" });
}

function createTarBlob(files) {
  const parts = [];
  const zeroBlock = new Uint8Array(512);

  for (const file of files) {
    const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
    const header = createTarHeader(file.path, data.length, getTarMode(file.path));
    parts.push(header, data);

    const paddingSize = (512 - (data.length % 512)) % 512;
    if (paddingSize) parts.push(new Uint8Array(paddingSize));
  }

  parts.push(zeroBlock, zeroBlock);
  return new Blob(parts, { type: "application/x-tar" });
}

function createTarHeader(path, size, mode) {
  const header = new Uint8Array(512);
  const { name, prefix } = splitTarPath(path);

  writeTarString(header, 0, 100, name);
  writeTarOctal(header, 100, 8, mode);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, size);
  writeTarOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeTarString(header, 257, 6, "ustar");
  writeTarString(header, 263, 2, "00");
  writeTarString(header, 345, 155, prefix);

  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeTarOctal(header, 148, 8, checksum);

  return header;
}

function splitTarPath(path) {
  const cleanPath = String(path).replace(/^\/+/, "");
  const pathBytes = new TextEncoder().encode(cleanPath);

  if (pathBytes.length <= 100) {
    return { name: cleanPath, prefix: "" };
  }

  const parts = cleanPath.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const prefix = parts.slice(0, index).join("/");
    const name = parts.slice(index).join("/");

    if (new TextEncoder().encode(prefix).length <= 155 && new TextEncoder().encode(name).length <= 100) {
      return { name, prefix };
    }
  }

  throw new Error(`${path} is too long for tar export.`);
}

function writeTarString(header, offset, length, value) {
  const bytes = new TextEncoder().encode(value);
  header.set(bytes.slice(0, length), offset);
}

function writeTarOctal(header, offset, length, value) {
  const octal = Math.trunc(value).toString(8).padStart(length - 1, "0").slice(-(length - 1));
  writeTarString(header, offset, length - 1, octal);
  header[offset + length - 1] = 0;
}

function getTarMode(path) {
  return /(?:^|\/)start\.sh$/i.test(path) ? 0o755 : 0o644;
}

function createZipBlob(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.path);
    const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
    const crc = crc32(data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);

    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);

    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);

  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return new Blob([...localParts, ...centralParts, endRecord], { type: "application/zip" });
}

function crc32(data) {
  let crc = -1;

  for (let index = 0; index < data.length; index += 1) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ data[index]) & 0xff];
  }

  return (crc ^ -1) >>> 0;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
})();

function sanitizeFileName(filename) {
  return String(filename).replace(/[\\/:*?"<>|]/g, "_").replace(/^\.+$/, "_");
}

function createUniqueZipPath(path, usedPaths) {
  if (!usedPaths.has(path)) {
    usedPaths.add(path);
    return path;
  }

  const dotIndex = path.lastIndexOf(".");
  const base = dotIndex > -1 ? path.slice(0, dotIndex) : path;
  const extension = dotIndex > -1 ? path.slice(dotIndex) : "";
  let counter = 2;
  let nextPath = `${base}-${counter}${extension}`;

  while (usedPaths.has(nextPath)) {
    counter += 1;
    nextPath = `${base}-${counter}${extension}`;
  }

  usedPaths.add(nextPath);
  return nextPath;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value ?? 0);
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes) || 0;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const maximumFractionDigits = unitIndex === 0 ? 0 : 1;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value)} ${units[unitIndex]}`;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function createSearchCacheKey({ query, minecraftVersion, loader, limit, index }) {
  return [
    "combined",
    query.trim().toLowerCase(),
    minecraftVersion,
    loader,
    limit,
    index,
  ].join("|");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[char];
  });
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function digestHex(algorithm, data) {
  const digest = await crypto.subtle.digest(algorithm, data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizePack(pack) {
  const fallback = defaultPack();
  const mods = Array.isArray(pack?.mods) ? pack.mods.map(normalizeSavedMod) : [];

  return {
    ...fallback,
    ...pack,
    id: pack?.id || fallback.id,
    name: pack?.name || fallback.name,
    minecraftVersion: pack?.minecraftVersion || fallback.minecraftVersion,
    loader: pack?.loader || fallback.loader,
    mods,
    createdAt: pack?.createdAt || fallback.createdAt,
    updatedAt: pack?.updatedAt || fallback.updatedAt,
  };
}

function normalizeSavedMod(mod) {
  const dependencies = Array.isArray(mod?.dependencies) ? mod.dependencies : [];
  const source = mod?.source || (String(mod?.projectId || mod?.project_id || "").startsWith("curseforge:") ? "curseforge" : "modrinth");
  const curseForgeId = source === "curseforge" ? getCurseForgeId(mod) : undefined;

  return {
    ...mod,
    source,
    projectId: mod?.projectId || mod?.project_id || "",
    curseForgeId,
    title: mod?.title || "Unknown mod",
    clientSide: mod?.clientSide || "unknown",
    serverSide: mod?.serverSide || "unknown",
    side: mod?.side || inferSide(mod?.clientSide, mod?.serverSide),
    dependencies,
    dependencyIds: Array.isArray(mod?.dependencyIds) ? mod.dependencyIds : getRequiredDependencyIds(dependencies),
    requiredBy: normalizeRequiredBy(mod?.requiredBy),
    autoInstalled: Boolean(mod?.autoInstalled),
  };
}

function sortByUpdated(a, b) {
  return String(b.updatedAt).localeCompare(String(a.updatedAt));
}

function isMinecraftReleaseVersion(version) {
  return /^1\.\d+(?:\.\d+)?$/.test(String(version));
}

function compareMinecraftVersionsDesc(a, b) {
  const aParts = parseMinecraftVersion(a);
  const bParts = parseMinecraftVersion(b);
  const maxLength = Math.max(aParts.length, bParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const difference = (bParts[index] ?? 0) - (aParts[index] ?? 0);
    if (difference !== 0) return difference;
  }

  return String(b).localeCompare(String(a));
}

function parseMinecraftVersion(version) {
  return String(version).split(".").map((part) => Number.parseInt(part, 10));
}

function uniquePackName(baseName) {
  const names = new Set(packs.map((pack) => pack.name));

  if (!names.has(baseName)) return baseName;

  let counter = 2;
  while (names.has(`${baseName} ${counter}`)) {
    counter += 1;
  }

  return `${baseName} ${counter}`;
}

function createId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `pack-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
