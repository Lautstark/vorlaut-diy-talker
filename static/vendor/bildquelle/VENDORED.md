# Vendored: @lautstark/bildquelle

Symbol search for ARASAAC and for the user's own licensed METACOM folder.
Not written here — this is a copy. Edit it upstream.

| | |
|---|---|
| Source | https://github.com/Lautstark/bildquelle |
| Commit | `f62dfcc085a69fa90c562f8ce8f137e74c659a55` |
| Vendored | 2026-08-22 |
| Licence | MIT. Bundles [idb](https://github.com/jakearchibald/idb) (ISC) and, in the lazy chunk, [JSZip](https://stuk.github.io/jszip/) (MIT). |

This is the `dist/browser/` build: self-contained ES modules with no bare
imports, because vorlaut has no bundler to resolve them. `index.js` is the
entry; the `jszip.min-*.js` chunk loads only if someone reads their METACOM
collection from a ZIP.

## Refreshing it

```bash
git clone https://github.com/Lautstark/bildquelle /tmp/bildquelle
cd /tmp/bildquelle && git checkout <commit> && npm install
cp dist/browser/*.js <vorlaut>/static/vendor/bildquelle/
```

`npm install` runs the build through `prepare`. Update the commit above.

## Why vendored rather than an npm dependency

vorlaut serves `static/` as plain ES modules, so a bare `@lautstark/bildquelle`
does not resolve on its own. An import map points it at this directory, and that
map is in `ui.html` — the page imports symbols.js, which imports this, so the
entry names a module the page really loads. `tools/symbolcheck.html` carries its
own copy of the entry because an import map is per document.

The specifier is bare rather than a relative path, which keeps the option of a
bundler open — delete the map, add the dependency, no application code moves.
That is an option and not a plan: an import map is a fine place for vorlaut to
stop, given a project whose point is having no build step.
