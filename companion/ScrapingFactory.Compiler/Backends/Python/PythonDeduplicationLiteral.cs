using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Issue #225: builds the single Scriban context object every non-Blocks
// template renders `dedup.*` from — an `enabled` flag, the `incremental`/
// `append` switches the templates branch on, and `code`, the complete
// runtime helper block, inserted verbatim at module level.
//
// Unlike most other features' runtime helpers (hand-duplicated per template,
// because Scriban has no cross-template includes), this block is rendered
// here in C# and handed to each template as one string: the state-file I/O,
// retention pruning and key construction are identical across all six
// templates, and the per-shape part (flat rows vs. a tree of repeating group
// instances) only differs between two variants, not six. The block has no
// Scriban syntax in it, so the template engine passes it through untouched,
// and it imports what it needs under private aliases so it never depends on
// (or clashes with) a template's own conditional imports.
//
// Key matching per shape:
//  - Flat / Api-flat: the key fields are columns of a row dict.
//  - Tree (container / Api-tree): the key is looked up by tag name inside
//    each repeating group instance, but only in the instance's *own scope* —
//    nested repeating instances are skipped — so the instance that directly
//    owns every key field is the one that gets deduplicated (an outer
//    "category" instance is not keyed by its first child item's title). An
//    instance that does not own all key fields is simply not deduplicated.
internal static class PythonDeduplicationLiteral
{
    public static object BuildContext(DeduplicationConfig? dedup, bool isTreeShape)
    {
        if (dedup is null)
            return new { enabled = false, incremental = false, append = false, code = "" };

        var append = dedup.Incremental && dedup.IncrementalOutput == IncrementalOutputMode.Append;
        var code = (CommonCode + (isTreeShape ? TreeCode : FlatCode))
            .Replace("__KEY_FIELDS__", PythonLiteral.StrList(dedup.KeyFields))
            .Replace("__INCREMENTAL__", dedup.Incremental ? "True" : "False")
            .Replace("__APPEND__", append ? "True" : "False")
            .Replace("__RETENTION_KIND__", PythonLiteral.Str(dedup.Retention.Kind.ToString()))
            .Replace("__RETENTION_VALUE__", dedup.Retention.Value.ToString(System.Globalization.CultureInfo.InvariantCulture));

        return new { enabled = true, incremental = dedup.Incremental, append, code };
    }

    private const string CommonCode = """
# Issue #225 (deduplication): see IR/DeduplicationConfig.cs. KEY_FIELDS is
# the (composite) identity of a row/element. Within a run, a later row with
# an already-seen key is dropped. With INCREMENTAL, keys seen in earlier
# runs are remembered in a sidecar file next to the output
# (OUTPUT_PATH + ".dedup-seen.json", key -> unix timestamp of the last time
# it was seen) and only genuinely new rows/elements are written. A row whose
# key fields are all empty has no identity: it is never dropped and never
# remembered (so in incremental mode it is written on every run).
import json as _dd_json
import os as _dd_os
import sys as _dd_sys
import time as _dd_time
import csv as _dd_csv

DEDUP_KEY_FIELDS = __KEY_FIELDS__
DEDUP_INCREMENTAL = __INCREMENTAL__
DEDUP_APPEND = __APPEND__
DEDUP_RETENTION_KIND = __RETENTION_KIND__
DEDUP_RETENTION_VALUE = __RETENTION_VALUE__
DEDUP_STATE_PATH = OUTPUT_PATH + ".dedup-seen.json"
_dedup_dropped_count = 0


# Bounds the sidecar file: MaxAge forgets keys not seen for N days (they
# count as new again), MaxCount keeps the N most recently seen keys.
def _dedup_prune(seen, now):
    if DEDUP_RETENTION_KIND == "MaxAge":
        cutoff = now - DEDUP_RETENTION_VALUE * 86400
        return {key: stamp for key, stamp in seen.items() if stamp >= cutoff}
    if len(seen) > DEDUP_RETENTION_VALUE:
        newest = sorted(seen.items(), key=lambda item: item[1], reverse=True)[:DEDUP_RETENTION_VALUE]
        return dict(newest)
    return seen


# A missing or unreadable sidecar (first run ever, or it was deleted) simply
# means "nothing seen yet" — never an error.
def _dedup_load_state():
    if not DEDUP_INCREMENTAL:
        return {}
    try:
        with open(DEDUP_STATE_PATH, "r", encoding="utf-8") as f:
            raw = _dd_json.load(f).get("seen", {})
        seen = {str(key): float(stamp) for key, stamp in raw.items()}
    except (OSError, ValueError, AttributeError, TypeError):
        return {}
    return _dedup_prune(seen, _dd_time.time())


_DEDUP_SEEN = _dedup_load_state()


# Records every key of this run as seen "now" and writes the sidecar. Called
# from main() only once the run is otherwise done (after hardening's own
# pass/fail decision), so a run that is about to be flagged as failed never
# marks its rows as seen — the next run would otherwise silently skip them.
def _dedup_save_state(current_keys):
    if not DEDUP_INCREMENTAL:
        return
    now = _dd_time.time()
    seen = dict(_DEDUP_SEEN)
    for key in current_keys:
        seen[key] = now
    seen = _dedup_prune(seen, now)
    with open(DEDUP_STATE_PATH, "w", encoding="utf-8") as f:
        _dd_json.dump({"seen": seen}, f, ensure_ascii=False)


def _dedup_key(values):
    if all(not value for value in values):
        return None
    return _dd_json.dumps(values, ensure_ascii=False)

""";

    private const string FlatCode = """

# Flat shape: drops later rows whose key already appeared in this run.
# Returns the unique rows plus a parallel list of their keys (None for a row
# without any key value).
def _dedup_filter_rows(rows):
    global _dedup_dropped_count
    seen_in_run = set()
    unique_rows = []
    keys = []
    for row in rows:
        key = _dedup_key([str(row.get(name, "") or "").strip() for name in DEDUP_KEY_FIELDS])
        if key is not None:
            if key in seen_in_run:
                _dedup_dropped_count += 1
                continue
            seen_in_run.add(key)
        unique_rows.append(row)
        keys.append(key)
    if _dedup_dropped_count:
        print(f"Deduplication: dropped {_dedup_dropped_count} duplicate row(s).")
    return unique_rows, keys


# Incremental mode: only the rows whose key was not seen in an earlier run.
def _dedup_new_rows(rows, keys):
    if not DEDUP_INCREMENTAL:
        return rows
    new_rows = [row for row, key in zip(rows, keys) if key is None or key not in _DEDUP_SEEN]
    print(f"Deduplication: {len(new_rows)} of {len(rows)} row(s) are new since the last run.")
    return new_rows


# Append mode: keeps the previous output file's rows in front of the new
# ones. Must be called before the output file is overwritten. `fieldnames`
# is only used for CSV (a previous column that is no longer written is
# dropped, a missing one is filled with an empty value).
def _dedup_with_previous_output(new_rows, fieldnames):
    if not (DEDUP_INCREMENTAL and DEDUP_APPEND) or not _dd_os.path.exists(OUTPUT_PATH):
        return new_rows
    try:
        with open(OUTPUT_PATH, "r", encoding="utf-8", newline="") as f:
            if OUTPUT_PATH.lower().endswith(".json"):
                previous = _dd_json.load(f)
                if not isinstance(previous, list):
                    return new_rows
            else:
                previous = [{name: (row.get(name) or "") for name in fieldnames} for row in _dd_csv.DictReader(f)]
    except (OSError, ValueError):
        return new_rows
    return previous + new_rows
""";

    private const string TreeCode = """

# Tree shape: ids of every repeating group instance that made it into the
# tree (so a parent's own-scope key lookup can skip them), the key of every
# keyed instance, and the keys seen so far in this run. The elements are also
# kept alive in a list: an instance dropped later (e.g. by the required-fields
# check) could otherwise be garbage collected and have its id reused by a new
# element, which would then be mistaken for a registered instance.
_DEDUP_REPEATING_IDS = set()
_DEDUP_KEY_BY_ID = {}
_DEDUP_RUN_KEYS = set()
_DEDUP_KEEPALIVE = []
_dedup_keyed_instances = 0


def _dedup_own_scope_value(el, name):
    for child in el:
        if id(child) in _DEDUP_REPEATING_IDS:
            continue
        if child.tag == name:
            return (child.text or "").strip()
        found = _dedup_own_scope_value(child, name)
        if found is not None:
            return found
    return None


# Called from the group walker right after one *repeating* instance is fully
# built. Returns False when the instance is a within-run duplicate and must
# be dropped.
def _dedup_register_instance(el):
    global _dedup_dropped_count, _dedup_keyed_instances
    values = []
    for name in DEDUP_KEY_FIELDS:
        value = _dedup_own_scope_value(el, name)
        if value is None:
            values = None
            break
        values.append(value)
    key = _dedup_key(values) if values is not None else None
    if key is not None:
        _dedup_keyed_instances += 1
        if key in _DEDUP_RUN_KEYS:
            _dedup_dropped_count += 1
            return False
        _DEDUP_RUN_KEYS.add(key)
        _DEDUP_KEY_BY_ID[id(el)] = key
    _DEDUP_REPEATING_IDS.add(id(el))
    _DEDUP_KEEPALIVE.append(el)
    return True


# Every key of an instance that is actually part of the final tree.
def _dedup_collect_keys(el, keys=None):
    if keys is None:
        keys = []
    for child in el:
        key = _DEDUP_KEY_BY_ID.get(id(child))
        if key is not None:
            keys.append(key)
        _dedup_collect_keys(child, keys)
    return keys


# Incremental mode: a fresh copy of the tree without the instances seen in an
# earlier run — never mutates `el`, since hardening and the key collection
# still need the full tree. Without incremental mode `el` itself is returned.
def _dedup_delta_tree(el):
    if not DEDUP_INCREMENTAL:
        return el
    clone = ET.Element(el.tag, el.attrib)
    clone.text = el.text
    for child in el:
        key = _DEDUP_KEY_BY_ID.get(id(child))
        if key is not None and key in _DEDUP_SEEN:
            continue
        clone.append(_dedup_delta_tree(child))
    return clone


def _dedup_report():
    if _dedup_dropped_count:
        print(f"Deduplication: dropped {_dedup_dropped_count} duplicate element(s).")
    if _dedup_keyed_instances == 0:
        print(
            "WARNING: Deduplication is configured, but no repeating group contains all key fields "
            f"({', '.join(DEDUP_KEY_FIELDS)}) — nothing was deduplicated.",
            file=_dd_sys.stderr,
        )
""";
}
