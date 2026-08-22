import "./chunk-E4AONNX5.js";

// node_modules/idb/build/index.js
var instanceOfAny = (object, constructors) => constructors.some((c) => object instanceof c);
var idbProxyableTypes;
var cursorAdvanceMethods;
function getIdbProxyableTypes() {
  return idbProxyableTypes || (idbProxyableTypes = [
    IDBDatabase,
    IDBObjectStore,
    IDBIndex,
    IDBCursor,
    IDBTransaction
  ]);
}
function getCursorAdvanceMethods() {
  return cursorAdvanceMethods || (cursorAdvanceMethods = [
    IDBCursor.prototype.advance,
    IDBCursor.prototype.continue,
    IDBCursor.prototype.continuePrimaryKey
  ]);
}
var transactionDoneMap = /* @__PURE__ */ new WeakMap();
var transformCache = /* @__PURE__ */ new WeakMap();
var reverseTransformCache = /* @__PURE__ */ new WeakMap();
function promisifyRequest(request) {
  const promise = new Promise((resolve, reject) => {
    const unlisten = () => {
      request.removeEventListener("success", success);
      request.removeEventListener("error", error);
    };
    const success = () => {
      resolve(wrap(request.result));
      unlisten();
    };
    const error = () => {
      reject(request.error);
      unlisten();
    };
    request.addEventListener("success", success);
    request.addEventListener("error", error);
  });
  reverseTransformCache.set(promise, request);
  return promise;
}
function cacheDonePromiseForTransaction(tx) {
  if (transactionDoneMap.has(tx))
    return;
  const done = new Promise((resolve, reject) => {
    const unlisten = () => {
      tx.removeEventListener("complete", complete);
      tx.removeEventListener("error", error);
      tx.removeEventListener("abort", error);
    };
    const complete = () => {
      resolve();
      unlisten();
    };
    const error = () => {
      reject(tx.error || new DOMException("AbortError", "AbortError"));
      unlisten();
    };
    tx.addEventListener("complete", complete);
    tx.addEventListener("error", error);
    tx.addEventListener("abort", error);
  });
  transactionDoneMap.set(tx, done);
}
var idbProxyTraps = {
  get(target, prop, receiver) {
    if (target instanceof IDBTransaction) {
      if (prop === "done")
        return transactionDoneMap.get(target);
      if (prop === "store") {
        return receiver.objectStoreNames[1] ? void 0 : receiver.objectStore(receiver.objectStoreNames[0]);
      }
    }
    return wrap(target[prop]);
  },
  set(target, prop, value) {
    target[prop] = value;
    return true;
  },
  has(target, prop) {
    if (target instanceof IDBTransaction && (prop === "done" || prop === "store")) {
      return true;
    }
    return prop in target;
  }
};
function replaceTraps(callback) {
  idbProxyTraps = callback(idbProxyTraps);
}
function wrapFunction(func) {
  if (getCursorAdvanceMethods().includes(func)) {
    return function(...args) {
      func.apply(unwrap(this), args);
      return wrap(this.request);
    };
  }
  return function(...args) {
    return wrap(func.apply(unwrap(this), args));
  };
}
function transformCachableValue(value) {
  if (typeof value === "function")
    return wrapFunction(value);
  if (value instanceof IDBTransaction)
    cacheDonePromiseForTransaction(value);
  if (instanceOfAny(value, getIdbProxyableTypes()))
    return new Proxy(value, idbProxyTraps);
  return value;
}
function wrap(value) {
  if (value instanceof IDBRequest)
    return promisifyRequest(value);
  if (transformCache.has(value))
    return transformCache.get(value);
  const newValue = transformCachableValue(value);
  if (newValue !== value) {
    transformCache.set(value, newValue);
    reverseTransformCache.set(newValue, value);
  }
  return newValue;
}
var unwrap = (value) => reverseTransformCache.get(value);
function openDB(name, version, { blocked, upgrade, blocking, terminated } = {}) {
  const request = indexedDB.open(name, version);
  const openPromise = wrap(request);
  if (upgrade) {
    request.addEventListener("upgradeneeded", (event) => {
      upgrade(wrap(request.result), event.oldVersion, event.newVersion, wrap(request.transaction), event);
    });
  }
  if (blocked) {
    request.addEventListener("blocked", (event) => blocked(
      // Casting due to https://github.com/microsoft/TypeScript-DOM-lib-generator/pull/1405
      event.oldVersion,
      event.newVersion,
      event
    ));
  }
  openPromise.then((db) => {
    if (terminated)
      db.addEventListener("close", () => terminated());
    if (blocking) {
      db.addEventListener("versionchange", (event) => blocking(event.oldVersion, event.newVersion, event));
    }
  }).catch(() => {
  });
  return openPromise;
}
var readMethods = ["get", "getKey", "getAll", "getAllKeys", "count"];
var writeMethods = ["put", "add", "delete", "clear"];
var cachedMethods = /* @__PURE__ */ new Map();
function getMethod(target, prop) {
  if (!(target instanceof IDBDatabase && !(prop in target) && typeof prop === "string")) {
    return;
  }
  if (cachedMethods.get(prop))
    return cachedMethods.get(prop);
  const targetFuncName = prop.replace(/FromIndex$/, "");
  const useIndex = prop !== targetFuncName;
  const isWrite = writeMethods.includes(targetFuncName);
  if (
    // Bail if the target doesn't exist on the target. Eg, getAll isn't in Edge.
    !(targetFuncName in (useIndex ? IDBIndex : IDBObjectStore).prototype) || !(isWrite || readMethods.includes(targetFuncName))
  ) {
    return;
  }
  const method = async function(storeName, ...args) {
    const tx = this.transaction(storeName, isWrite ? "readwrite" : "readonly");
    let target2 = tx.store;
    if (useIndex)
      target2 = target2.index(args.shift());
    return (await Promise.all([
      target2[targetFuncName](...args),
      isWrite && tx.done
    ]))[0];
  };
  cachedMethods.set(prop, method);
  return method;
}
replaceTraps((oldTraps) => ({
  ...oldTraps,
  get: (target, prop, receiver) => getMethod(target, prop) || oldTraps.get(target, prop, receiver),
  has: (target, prop) => !!getMethod(target, prop) || oldTraps.has(target, prop)
}));
var advanceMethodProps = ["continue", "continuePrimaryKey", "advance"];
var methodMap = {};
var advanceResults = /* @__PURE__ */ new WeakMap();
var ittrProxiedCursorToOriginalProxy = /* @__PURE__ */ new WeakMap();
var cursorIteratorTraps = {
  get(target, prop) {
    if (!advanceMethodProps.includes(prop))
      return target[prop];
    let cachedFunc = methodMap[prop];
    if (!cachedFunc) {
      cachedFunc = methodMap[prop] = function(...args) {
        advanceResults.set(this, ittrProxiedCursorToOriginalProxy.get(this)[prop](...args));
      };
    }
    return cachedFunc;
  }
};
async function* iterate(...args) {
  let cursor = this;
  if (!(cursor instanceof IDBCursor)) {
    cursor = await cursor.openCursor(...args);
  }
  if (!cursor)
    return;
  cursor = cursor;
  const proxiedCursor = new Proxy(cursor, cursorIteratorTraps);
  ittrProxiedCursorToOriginalProxy.set(proxiedCursor, cursor);
  reverseTransformCache.set(proxiedCursor, unwrap(cursor));
  while (cursor) {
    yield proxiedCursor;
    cursor = await (advanceResults.get(proxiedCursor) || cursor.continue());
    advanceResults.delete(proxiedCursor);
  }
}
function isIteratorProp(target, prop) {
  return prop === Symbol.asyncIterator && instanceOfAny(target, [IDBIndex, IDBObjectStore, IDBCursor]) || prop === "iterate" && instanceOfAny(target, [IDBIndex, IDBObjectStore]);
}
replaceTraps((oldTraps) => ({
  ...oldTraps,
  get(target, prop, receiver) {
    if (isIteratorProp(target, prop))
      return iterate;
    return oldTraps.get(target, prop, receiver);
  },
  has(target, prop) {
    return isIteratorProp(target, prop) || oldTraps.has(target, prop);
  }
}));

// src/storage.ts
var DB_NAME = "bildquelle";
var DB_VERSION = 1;
var dbPromise = null;
function getDB() {
  if (!dbPromise) {
    const opened = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore("arasaacSearch", { keyPath: "query" });
        db.createObjectStore("arasaacImages", { keyPath: "id" });
        db.createObjectStore("metacomIndex", { keyPath: "key" });
        db.createObjectStore("metacomHandles", { keyPath: "key" });
      },
      /* An old tab holding version n-1 open would otherwise leave openDB pending
       * forever, which presents to the user as symbols stuck on their spinner. */
      blocking() {
        opened.then((db) => db.close()).catch(() => void 0);
        dbPromise = null;
      },
      terminated() {
        dbPromise = null;
      }
    });
    dbPromise = opened.catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}
var arasaacCache = {
  async readSearch(query) {
    return (await getDB()).get("arasaacSearch", query);
  },
  async writeSearch(query, candidates) {
    await (await getDB()).put("arasaacSearch", { query, candidates, ts: Date.now() });
  },
  /** Scans cached result sets for a symbol id, for references restored from storage. */
  async findLabel(id) {
    const db = await getDB();
    let cursor = await db.transaction("arasaacSearch").store.openCursor();
    while (cursor) {
      const hit = cursor.value.candidates.find((c) => c.id === id);
      if (hit) return hit.label;
      cursor = await cursor.continue();
    }
    return null;
  },
  async readImage(id) {
    return (await (await getDB()).get("arasaacImages", id))?.blob ?? null;
  },
  async writeImage(id, blob) {
    await (await getDB()).put("arasaacImages", { id, blob, ts: Date.now() });
  },
  async clear() {
    const db = await getDB();
    await Promise.all([db.clear("arasaacSearch"), db.clear("arasaacImages")]);
  }
};
var INDEX_KEY = "metacom";
var HANDLE_KEY = "metacomDir";
var metacomStore = {
  async readIndex() {
    return (await getDB()).get("metacomIndex", INDEX_KEY);
  },
  async writeIndex(rootName, entries) {
    await (await getDB()).put("metacomIndex", { key: INDEX_KEY, rootName, entries, ts: Date.now() });
  },
  async readHandle() {
    return (await (await getDB()).get("metacomHandles", HANDLE_KEY))?.handle ?? null;
  },
  async writeHandle(handle) {
    await (await getDB()).put("metacomHandles", { key: HANDLE_KEY, handle });
  },
  async clear() {
    const db = await getDB();
    await Promise.all([
      db.delete("metacomIndex", INDEX_KEY),
      db.delete("metacomHandles", HANDLE_KEY)
    ]);
  }
};

// src/text.ts
function foldGerman(value) {
  return value.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
}
function scoreLabel(query, label) {
  const q = query.toLowerCase();
  const l = label.toLowerCase();
  if (l === q) return 100;
  if (l.startsWith(q + " ") || l.startsWith(q + "-")) return 70;
  if (l.startsWith(q)) return 55;
  const words = l.split(/[\s\-_/]+/);
  if (words.includes(q)) return 60;
  if (words.some((w) => w.startsWith(q))) return 40;
  if (l.includes(q)) return 25;
  return 5;
}

// src/arasaac.ts
var API = "https://api.arasaac.org/v1/pictograms/de";
var IMAGE = (id) => `https://static.arasaac.org/pictograms/${id}/${id}_500.png`;
var ARASAAC_ATTRIBUTION = "Piktogramme: ARASAAC (arasaac.org), CC BY-NC-SA. Autor: Sergio Palao. Urheber: Regierung von Arag\xF3n (Spanien).";
var wordCount = (label) => Math.max(0, label.trim().split(/\s+/).length - 1);
var SEARCH_TTL_MS = 1e3 * 60 * 60 * 24 * 30;
var ArasaacProvider = class {
  id = "arasaac";
  name = "ARASAAC";
  attribution = ARASAAC_ATTRIBUTION;
  #objectUrls = /* @__PURE__ */ new Map();
  #inFlight = /* @__PURE__ */ new Map();
  #labels = /* @__PURE__ */ new Map();
  #lastError = null;
  status() {
    return this.#lastError ? { kind: "error", message: this.#lastError } : { kind: "ready" };
  }
  isReady() {
    return true;
  }
  async search(query) {
    const key = query.toLowerCase().trim();
    if (!key) return [];
    const existing = this.#inFlight.get(key);
    if (existing) return existing;
    const task = this.#doSearch(key).finally(() => this.#inFlight.delete(key));
    this.#inFlight.set(key, task);
    return task;
  }
  async #doSearch(key) {
    const cached = await arasaacCache.readSearch(key);
    if (cached && Date.now() - cached.ts < SEARCH_TTL_MS) {
      this.#rememberLabels(cached.candidates);
      return cached.candidates;
    }
    let candidates = [];
    try {
      const res = await fetch(`${API}/search/${encodeURIComponent(key)}`, {
        headers: { Accept: "application/json" }
      });
      if (res.status === 404) {
        candidates = [];
      } else if (!res.ok) {
        throw new Error(`ARASAAC antwortete mit ${res.status}`);
      } else {
        const json = await res.json();
        candidates = this.#rank(key, Array.isArray(json) ? json : []);
      }
      this.#lastError = null;
    } catch (err) {
      if (cached) return cached.candidates;
      this.#lastError = err instanceof Error ? err.message : "Netzwerkfehler";
      return [];
    }
    await arasaacCache.writeSearch(key, candidates);
    this.#rememberLabels(candidates);
    return candidates;
  }
  #rank(query, pictograms) {
    return pictograms.map((p, apiRank) => {
      const keywords = (p.keywords ?? []).map((k) => k.keyword).filter(Boolean);
      const label = keywords[0] ?? String(p._id);
      const best = keywords.reduce((acc, kw) => Math.max(acc, scoreLabel(query, kw)), 0);
      const aacBonus = (p.aacColor ? 12 : 0) + (p.aac ? 8 : 0);
      const phrasePenalty = query.includes(" ") ? 0 : Math.min(30, wordCount(label) * 12);
      const penalty = (p.schematic ? 15 : 0) + (p.violence ? 40 : 0) + (p.sex ? 40 : 0) + phrasePenalty;
      return {
        id: String(p._id),
        label,
        score: best + aacBonus - penalty - apiRank * 0.5
      };
    }).sort((a, b) => b.score - a.score).slice(0, 24);
  }
  #rememberLabels(candidates) {
    for (const c of candidates) this.#labels.set(c.id, c.label);
  }
  async getImageUrl(id) {
    const cachedUrl = this.#objectUrls.get(id);
    if (cachedUrl) return cachedUrl;
    const stored = await arasaacCache.readImage(id);
    if (stored) {
      const url = URL.createObjectURL(stored);
      this.#objectUrls.set(id, url);
      return url;
    }
    try {
      const res = await fetch(IMAGE(id));
      if (!res.ok) return IMAGE(id);
      const blob = await res.blob();
      await arasaacCache.writeImage(id, blob);
      const url = URL.createObjectURL(blob);
      this.#objectUrls.set(id, url);
      return url;
    } catch {
      return IMAGE(id);
    }
  }
  async labelFor(id) {
    const known = this.#labels.get(id);
    if (known) return known;
    const found = await arasaacCache.findLabel(id);
    if (found) this.#labels.set(id, found);
    return found;
  }
};

// src/metacom.ts
var IMAGE_EXT = /\.(png|jpe?g|svg|webp|gif|bmp)$/i;
var MAX_LIVE_URLS = 400;
var MetacomProvider = class {
  id = "metacom";
  name = "METACOM";
  /** The user's own licensed copy; no attribution obligation on our side. */
  attribution = null;
  #source = { kind: "none" };
  #entries = [];
  #byPath = /* @__PURE__ */ new Map();
  #objectUrls = /* @__PURE__ */ new Map();
  #rootName = "";
  #status = { kind: "needs-setup", message: "Noch kein METACOM-Ordner ausgew\xE4hlt." };
  #listeners = /* @__PURE__ */ new Set();
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  #emit() {
    for (const l of this.#listeners) l();
  }
  #setStatus(status) {
    this.#status = status;
    this.#emit();
  }
  status() {
    return this.#status;
  }
  isReady() {
    return this.#status.kind === "ready" && this.#entries.length > 0;
  }
  get rootName() {
    return this.#rootName;
  }
  /**
   * How many image files were indexed. A count, not the index: the list of
   * filenames is derived from the user's licensed folder and stays inside this
   * package. Callers reach individual entries only through `search`, scoped to a
   * term the user typed.
   */
  get symbolCount() {
    return this.#entries.length;
  }
  /** True when the browser can persist the folder choice across visits. */
  static get supportsPersistentPicker() {
    return typeof globalThis.showDirectoryPicker === "function";
  }
  /* ------------------------------------------------------------ restore --- */
  /**
   * Re-attaches to a previously chosen folder on startup. Chromium keeps the
   * handle valid across visits but may still require a permission click, so a
   * failure here is normal and simply falls back to "needs setup".
   */
  async restore() {
    const stored = await metacomStore.readHandle();
    if (!stored) return false;
    const handle = stored;
    if (!await this.#ensureReadPermission(handle)) return false;
    this.#source = { kind: "handle", handle };
    const index = await metacomStore.readIndex();
    if (index && index.entries.length > 0) {
      this.#adopt(index.entries, index.rootName);
      return true;
    }
    await this.#buildIndexFromHandle(handle);
    return this.isReady();
  }
  /** Called when a restored handle needs the user to re-confirm permission. */
  async requestPermission() {
    const stored = await metacomStore.readHandle();
    if (!stored) return false;
    const handle = stored;
    try {
      const state = await handle.requestPermission?.({ mode: "read" }) ?? "granted";
      if (state !== "granted") return false;
    } catch {
      return false;
    }
    this.#source = { kind: "handle", handle };
    return this.restore();
  }
  /* -------------------------------------------------------------- pick ---- */
  /** Chromium path: one-time pick, remembered across visits. */
  async pickDirectory() {
    const picker = globalThis.showDirectoryPicker;
    if (!picker) throw new Error("Dieser Browser unterst\xFCtzt die Ordnerauswahl nicht.");
    await this.useDirectoryHandle(await picker({ mode: "read" }));
  }
  /**
   * Adopts a directory handle the host already holds — a handle carried over from
   * an older storage location, or one obtained by the host's own picker. The
   * capability granted is identical to `pickDirectory`: permission to read the
   * user's folder, in this browser, for as long as the browser honours it.
   */
  async useDirectoryHandle(handle) {
    this.#source = { kind: "handle", handle };
    await metacomStore.writeHandle(handle);
    if (!await this.#ensureReadPermission(handle)) return;
    await this.#buildIndexFromHandle(handle);
  }
  /**
   * Chromium keeps a handle valid across visits but may still want the user to
   * re-confirm, and that confirmation needs a gesture we do not have here. So a
   * refusal is not an error: it asks for a click and waits.
   */
  async #ensureReadPermission(handle) {
    const scoped = handle;
    try {
      if ((await scoped.queryPermission?.({ mode: "read" }) ?? "granted") === "granted") return true;
    } catch {
      return false;
    }
    this.#setStatus({
      kind: "needs-setup",
      message: "Zugriff auf den METACOM-Ordner muss erneut best\xE4tigt werden."
    });
    return false;
  }
  /** Firefox/Safari path: <input type="file" webkitdirectory>. Session-only. */
  async useFileList(fileList) {
    this.#setStatus({ kind: "loading", message: "Ordner wird gelesen \u2026" });
    const files = /* @__PURE__ */ new Map();
    const entries = [];
    for (const file of Array.from(fileList)) {
      const rel = file.webkitRelativePath || file.name;
      if (!IMAGE_EXT.test(rel)) continue;
      files.set(rel, file);
      entries.push(makeEntry(rel));
    }
    const root = entries.length > 0 ? firstSegment(entries[0].path) : "METACOM";
    this.#source = { kind: "files", files };
    await metacomStore.writeIndex(root, entries);
    this.#adopt(entries, root);
  }
  /** Last-resort path: a zip of the user's own symbol folder, unpacked in-browser. */
  async useZip(file) {
    this.#setStatus({ kind: "loading", message: "ZIP wird entpackt \u2026" });
    const { default: JSZip } = await import("./jszip.min-GIQOFNRZ.js");
    const zip = await JSZip.loadAsync(file);
    const entries = [];
    zip.forEach((path, entry) => {
      if (entry.dir || !IMAGE_EXT.test(path)) return;
      entries.push(makeEntry(path));
    });
    this.#source = { kind: "zip", zip };
    const root = file.name.replace(/\.zip$/i, "");
    await metacomStore.writeIndex(root, entries);
    this.#adopt(entries, root);
  }
  /** Forgets the folder, the index and every live URL. */
  async forget() {
    this.#revokeAll();
    this.#source = { kind: "none" };
    this.#entries = [];
    this.#byPath.clear();
    this.#rootName = "";
    await metacomStore.clear();
    this.#setStatus({ kind: "needs-setup", message: "Noch kein METACOM-Ordner ausgew\xE4hlt." });
  }
  /** Re-walks the folder, for when the user has added symbols since the last index. */
  async rebuildIndex() {
    if (this.#source.kind === "handle") await this.#buildIndexFromHandle(this.#source.handle);
  }
  /* ------------------------------------------------------------- index ---- */
  async #buildIndexFromHandle(handle) {
    this.#setStatus({ kind: "loading", message: "Symbole werden indiziert \u2026" });
    const entries = [];
    try {
      await walk(handle, "", entries);
    } catch (err) {
      this.#setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Ordner konnte nicht gelesen werden."
      });
      return;
    }
    await metacomStore.writeIndex(handle.name, entries);
    this.#adopt(entries, handle.name);
  }
  #adopt(entries, rootName) {
    this.#entries = entries;
    this.#byPath = new Map(entries.map((e) => [e.path, e]));
    this.#rootName = rootName;
    this.#setStatus(
      entries.length > 0 ? { kind: "ready" } : { kind: "error", message: "In diesem Ordner wurden keine Bilddateien gefunden." }
    );
  }
  /* ------------------------------------------------------------ search ---- */
  async search(query) {
    const term = query.trim();
    if (!term || this.#entries.length === 0) return [];
    const folded = foldGerman(term);
    const scored = [];
    for (const entry of this.#entries) {
      let best = scoreLabel(folded, foldGerman(entry.label));
      for (const t of entry.terms) best = Math.max(best, scoreLabel(folded, t));
      if (best >= 25) scored.push({ id: entry.path, label: entry.label, score: best });
    }
    return scored.sort((a, b) => b.score - a.score || a.label.length - b.label.length).slice(0, 24);
  }
  /* ------------------------------------------------------------- image ---- */
  async getImageUrl(id) {
    const live = this.#objectUrls.get(id);
    if (live) return live;
    const blob = await this.#readBlob(id);
    if (!blob) return null;
    if (this.#objectUrls.size >= MAX_LIVE_URLS) {
      const oldest = this.#objectUrls.keys().next().value;
      if (oldest !== void 0) {
        URL.revokeObjectURL(this.#objectUrls.get(oldest));
        this.#objectUrls.delete(oldest);
      }
    }
    const url = URL.createObjectURL(blob);
    this.#objectUrls.set(id, url);
    return url;
  }
  /**
   * The only place licensed bytes are touched, and they go straight into an
   * object URL. Nothing else in this package receives a Blob from here.
   */
  async #readBlob(path) {
    const source = this.#source;
    try {
      if (source.kind === "handle") {
        const segments = path.split("/").filter(Boolean);
        let dir = source.handle;
        for (const segment of segments.slice(0, -1)) {
          dir = await dir.getDirectoryHandle(segment);
        }
        const fileHandle = await dir.getFileHandle(segments[segments.length - 1]);
        return await fileHandle.getFile();
      }
      if (source.kind === "files") return source.files.get(path) ?? null;
      if (source.kind === "zip") return await source.zip.file(path)?.async("blob") ?? null;
    } catch {
      return null;
    }
    return null;
  }
  async labelFor(id) {
    return this.#byPath.get(id)?.label ?? null;
  }
  #revokeAll() {
    for (const url of this.#objectUrls.values()) URL.revokeObjectURL(url);
    this.#objectUrls.clear();
  }
};
async function walk(dir, prefix, out) {
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      await walk(handle, path, out);
    } else if (IMAGE_EXT.test(name)) {
      out.push(makeEntry(path));
    }
  }
}
var firstSegment = (path) => path.split("/")[0] ?? "METACOM";
function makeEntry(path) {
  const base = path.split("/").pop() ?? path;
  const stem = base.replace(IMAGE_EXT, "");
  const label = stem.replace(/[_]+/g, " ").replace(/(?<=\D)-(?=\D)/g, " ").replace(/[-\s]*\d+\s*$/, "").replace(/\s+/g, " ").trim() || stem;
  const terms = [...new Set(
    foldGerman(label).split(/[\s\-_/]+/).map((t) => t.trim()).filter((t) => t.length >= 2)
  )];
  return { path, label, terms };
}

// src/registry.ts
var arasaac = new ArasaacProvider();
var metacom = new MetacomProvider();
var REGISTRY = { arasaac, metacom };
function getProvider(id) {
  return REGISTRY[id];
}
var PROVIDER_IDS = ["arasaac", "metacom"];
function attributionsFor(ids) {
  const wanted = new Set(ids);
  return PROVIDER_IDS.filter((id) => wanted.has(id)).map((id) => REGISTRY[id].attribution).filter((text) => text !== null);
}
async function clearAllProviderData() {
  await Promise.all([arasaacCache.clear(), metacom.forget()]);
}
export {
  ARASAAC_ATTRIBUTION,
  ArasaacProvider,
  MetacomProvider,
  PROVIDER_IDS,
  arasaac,
  attributionsFor,
  clearAllProviderData,
  foldGerman,
  getProvider,
  metacom,
  scoreLabel
};
//# sourceMappingURL=index.js.map
