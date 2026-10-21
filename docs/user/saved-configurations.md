# Saved configurations

If you scrape the same site again and again, don't rebuild the setup each time.
**Save configuration** (next to **Export configuration** at the bottom of the
idle screen) stores the current fields, containers or API setup, together with
the engine, pagination and the other settings, in a small database on your
machine. Nothing is sent anywhere.

## Save and load

1. Build your scraper as usual.
2. Click **Save configuration** and name it (the site's name is pre-filled).
3. Next time you open that site, the **Saved configurations** panel at the bottom
   lists what you saved for it. Click **Load** to restore the setup.

Loading never changes the address: the page open in your browser stays the
page that will be scraped. Your personal preferences (output format, preview,
and so on) are not overwritten either — loading someone else's configuration
can't change them.

**Delete** asks for confirmation inline (**Yes** / **No**) because it is the one
action that removes something stored.

All your saved configurations, for every site, are listed in **Settings → All
saved configurations**.

## Export

**Export configuration** downloads the current setup as a JSON file instead.
It is the same data the companion receives, and is handy to attach to a bug
report.

## Saving a run's output

After a successful run, **Save output** on the done screen stores the scraped
data and links it to a saved configuration. If the site has none yet, the same
dialog lets you create one in one step. Each saved configuration then has an
**Outputs** list where you can **Download** or **Delete** past outputs, and
**Test hardening** against them (see [monitoring](monitoring.md)).

## Combining configurations

Saved configurations are also the building blocks of
[Combined mode](modes.md#combined): pick several, from any site, into one script.
