# Build configuration

## `d3fend.json` — generated, do not edit

The D3FEND release lives in one place: the `D3FEND_VERSION` variable at the top of
[app/scripts/rebuild-data.sh](../scripts/rebuild-data.sh). This file is what that
script projects out of the gated ontology so the app can read it — the page header
imports it in [app/src/main.js](../src/main.js).

| key           | meaning                                                              |
| ------------- | -------------------------------------------------------------------- |
| `version`     | `D3FEND_VERSION`, confirmed against the ontology's `owl:versionInfo` |
| `releaseDate` | the ontology's `d3f:release-date`, date part only                    |
| `ontologyIRI` | the D3FEND ontology IRI                                              |
| `homepage`    | where the header's version chip links                                |

Upgrading D3FEND:

```sh
# bump D3FEND_VERSION in app/scripts/rebuild-data.sh, then
bash app/scripts/rebuild-data.sh --fetch-d3fend
```

That downloads the release, normalizes the D3FEND namespace to the `d3f:` prefix,
refuses to continue if the download declares a different `owl:versionInfo`,
rewrites this file, and only then rebuilds every projection under
`app/src/data/`. So the header cannot advertise a release the data files were not
built from.
