# Third-Party Notices

Scraping Factory itself is licensed under the MIT License (see `LICENSE`). This
project uses the following third-party components, listed here for
attribution. All of them use permissive licenses (MIT / BSD-2-Clause /
Apache-2.0) that are compatible with Scraping Factory's MIT license and do not
impose any copyleft obligations.

## Shipped with the companion app

### Scriban
Used by `ScrapingFactory.Compiler` to render the Python code templates.

- License: BSD-2-Clause
- Copyright (c) 2016-2026, Alexandre Mutel
- https://github.com/scriban/scriban

## Runtime dependencies of the generated Python scripts

The scripts produced by Scraping Factory (not this repository itself) depend
on the following packages at runtime, on whatever machine the end user runs
the generated script on:

### requests
Used by all generated scripts (static, browser-engine helper calls, and API
mode) to perform HTTP requests.

- License: Apache License 2.0
- Copyright 2019 Kenneth Reitz
- https://github.com/psf/requests

### beautifulsoup4
Used by scripts generated for the static (`requests` + BeautifulSoup) engine
to parse HTML.

- License: MIT
- Copyright (c) Leonard Richardson
- Incorporates soupsieve (MIT) and html5lib (MIT) as dependencies
- https://www.crummy.com/software/BeautifulSoup/

### Playwright (Python)
Used by scripts generated for the browser engine to drive a headless
Chromium instance.

- License: Apache License 2.0
- Copyright (c) Microsoft Corporation
- https://github.com/microsoft/playwright-python

## Development-only dependencies

The following are used only during development/testing and are not
distributed as part of the extension, the companion app, or any generated
script:

- xunit, xunit.runner.visualstudio — MIT (companion test suite)
- Microsoft.NET.Test.Sdk, Microsoft.AspNetCore.Mvc.Testing — MIT (companion test suite)
- coverlet.collector — MIT (test coverage)
- jest, jest-environment-jsdom — MIT (extension test suite)
