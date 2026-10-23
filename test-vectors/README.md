# Contract vectors and wire fixtures (Issue #388)

Several behaviors exist twice: once in the extension (JavaScript) and once in the companion or in the scripts it
generates (C#, Python). The two copies have to agree, and nothing but a test can make sure of it. The files here are
read by **both** sides, so changing only one side fails a test.

## Vector files

`*.json` with this shape:

```json
{ "description": "what is pinned and by whom", "cases": [ { "name": "unique, readable", "...": "inputs and expected output" } ] }
```

| File | Pins | JavaScript | Companion / script |
| --- | --- | --- | --- |
| `file-name-sanitizer.json` | script/output file name cleanup | `sanitizeFileNameBase` | `FileNameSanitizer` |
| `transforms.json` | transform chains on a value (live preview vs. runtime) | `applyTransformsPreview` | `_apply_transforms` of a generated script |
| `robots.json` | robots.txt matching (RFC 9309) | `evaluateRobotsTxt` | `_parse_robots_rules`/`_robots_allowed` |
| `range-format.json` | does a value match a range format | `compileRangeFormatPattern` | `RangeFormat.IsValid`, `_compile_range_format` |
| `range-expansion.json` | values a range expands to | — | `RangeFormat.CountValues`, `_iso_week_range`/`_date_range`/`_number_range` |
| `url-template.json` | which recorded requests reveal values of a placeholder | `findUrlTemplateMatches` | `_match_url_against_template` |
| `text-selector.json` | splitting a trailing `:contains("…")` | popup and content-script `splitTextFilter` | `SelectorTextFilter`, `_split_text_filter` |
| `env-var-name.json` | valid environment-variable names | `ENV_VAR_NAME_PATTERN` | `ScrapingPlanValidator` |

A case may carry `"appliesTo": ["js"]` or `["python"]` when only one side can run it, always with a `note` saying why
(for example, the script knows its own `ScrapingFactory` robots.txt token, the advisory check does not).

The Python side runs the **real helper from a generated script**: `PythonContractHarness` imports the script as a
module and calls the function with the vectors, so there is no second copy of the helper to drift.

## Wire fixtures (`wire/`)

One request body per popup state, produced by the extension's real builders
(`extension/popup/wire-fixtures.test.js`) and verified byte for byte. The companion
(`WireFixtureTests.cs`) deserializes each strictly into `ScrapingConfig` (an unknown property fails) and sends it
through `/generate` with `skipVerification`.

```bash
UPDATE_WIRE_FIXTURES=1 npx --prefix extension jest popup/wire-fixtures   # accept a changed builder output, then review the diff
```
