# Output formats and blueprints

## Output format

Choose the format in **Settings** (the gear icon) → **Output format**. It
applies to every scraper you build.

| Format | Written as |
| --- | --- |
| **Default (CSV, XML for nested results)** | `output.csv` for flat data, `output.xml` for nested |
| **JSON** | `output.json`: a list of records, or a nested object for nested data |
| **SQLite database** | `output.sqlite`, one table `data` |
| **Excel (.xlsx)** | `output.xlsx`, one sheet `Data` |

Notes:

- SQLite and Excel are tables. A nested result (containers, or nested API data)
  is *flattened* into one row per innermost item, with higher-level values
  repeated on every row; the extension tells you when that happens.
- Excel needs `pip install openpyxl` where the script runs.
- The script and output file names come from **Script name** and **Output file
  name** at the bottom of the idle screen. In **Settings**, **Default script
  name** can be a fixed name or derived from the website's hostname.

Other output-related preferences in **Settings**: **Show trial-run data
preview**, **Download the full scraped data file** (the complete trial-run
output, from the done screen), **Editable config file (XML)**, and **Skip the
trial run (return the script immediately)** — faster, but the script is then not
proven to work.

## Append instead of replace

**Append to the existing output file instead of replacing it** makes every run
add to the file the earlier runs left, for any format — useful for a price
history. If the existing file has different columns, it keeps its own, adds new
ones, and leaves gaps empty. A file it can't read stops the run (exit code
**10**) without touching it.

## Remove duplicates

**Remove duplicates by key field(s)** drops a later row whose key (one or
several fields) already appeared. With **Only write new items since the last
run** the script remembers the keys it has seen in a small file and writes only
new items — either just the new ones, or appended to the growing file.

## Output blueprints

A **blueprint** is a saved list of target field names in a fixed order — the
column set your downstream import expects. With a blueprint selected (**Output
blueprint** in the idle screen's Settings), you map each target field to one of
your scraper's fields, and the output always has exactly those names in exactly
that order, whichever scraper produced it.

Create and edit blueprints under **Settings → Output blueprints**. You can type
the fields, or **paste or upload a sample** (a JSON object, a CSV header row or a
list of names) and **Parse & fill fields**.

A blueprint can be **Flat** or **Tree** (nested target structure). Nested
scraper output can be mapped onto a flat blueprint — it is flattened into rows —
or onto a tree blueprint, where each target group draws from its own source
group.

Blueprints are not available for Combined and Blocks mode.
