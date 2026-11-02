# Hrefine

Parses and serializes URLs exactly as the [WHATWG URL
Standard](https://url.spec.whatwg.org/) says, which browsers follow,
with the same results in every language.

Most languages' own URL parsers follow older rules, or their own, so
the same URL can name a different host in Python, Java, C#, and the
browser. Those gaps have caused real security holes: server-side
request forgery and allowlist bypasses, where a check reads a URL one
way and the request goes another. This library reads every URL as the
standard says, in every language it supports, checked against the
browsers' own test cases.

Parsing and serializing work on every backend, international domain
names included, and so do the standard's setters and search parameters
(`URLSearchParams`), a strict mode, and policies: the usual security
checks (schemes, credentials, private and loopback addresses, host
allowlists, ports, and redirect targets) in one call, on the parsed URL, with
a preset for URLs a server fetches. Credentials (the username and
password written in the URL, as in `https://user:pass@host/`; not
cookies, headers, or tokens in the query) are hard to expose: `href`
leaves them out, `toString` masks them, the display form leaves them
out, and policies never echo them. And for people and tools: a display form, as browsers
show URLs, comparisons, and where each part was written. See the [plan](docs/plan.md) for
what's next.

## Examples

In Temper, and the same API in each supported language (to refine
before 1.0). The names are JavaScript's, so `parseUrl` throws (bubbles)
as `new URL()` does, and `Url.parse` gives null:

```temper
let url = parseUrl("https://user@EXAMPLE.com:443/a/../b?q=1#top") orelse panic();
url.href;     // "https://example.com/b?q=1#top", to hand on: no credentials
url.toString(); // "https://***@example.com/b?q=1#top", for logs
url.hrefWithCredentials(); // "https://user@example.com/b?q=1#top", only to send them
url.hostname; // "example.com" (lowercased; the default port is dropped)
url.pathname; // "/b"

// Relative to a base, given as a string, or parsed once and reused.
(parseUrl("../c", "https://example.com/a/b") orelse panic()).href; // "https://example.com/c"
let base = parseUrl("https://example.com/a/b") orelse panic();
(base.resolve("../c") orelse panic()).href; // "https://example.com/c"

// Inputs that aren't URLs bubble, or give null, or say why.
Url.parse("https://exa mple.com");     // null
Url.canParse("https://exa mple.com");  // false
(checkUrl("https://exa mple.com") orelse panic()).errors; // [domain-invalid-code-point at 8]

// Typed parts, beside the standard's strings.
url.scheme;     // "https"
url.portNumber; // null (443 is the default)
url.hostKind;   // HostKind.domain
(parseUrl("http://0x7f.1/") orelse panic()).hostKind; // HostKind.ipv4, 127.0.0.1
url.sameOrigin(base); // true

// International domain names, as browsers read them.
(parseUrl("https://Bücher.example") orelse panic()).hostname; // "xn--bcher-kva.example"
domainToUnicode("xn--bcher-kva.example"); // "bücher.example"

// The strict RFC 3986 form, for parsers such as Java's URI.
(parseUrl("https://example.com/a|b?q={x}") orelse panic()).strictHref; // "https://example.com/a%7Cb?q=%7Bx%7D"

// Setters give a new URL; url itself never changes.
let moved = url.withHost("example.org:8443").withPathname("/c d").withHash("");
moved.href; // "https://example.org:8443/c%20d?q=1"
url.withPort("x").port; // "" (as in JavaScript, a value that can't be set is ignored)
url.withPortNumber(8443).port; // "8443"

// Search parameters: a copy of the query, changed in place, then put back.
let params = moved.searchParams;
params.append("lang", "en US");
params.set("q", "2");
moved.withSearchParams(params).search; // "?q=2&lang=en+US"
UrlSearchParams.fromEntries([new Pair("q", "a b")]).toString(); // "q=a+b"

// Strict mode: no validation errors, as cautious parsers take URLs.
(checkUrl("http://0x7f.1/") orelse panic()).strictUrl; // null: IPv4-non-decimal-part, IPv4-non-canonical

// Policies: built once, a rule at a time, then checked against many URLs.
// UrlPolicy.fetch is https only, strict, with no credentials, special hosts,
// or ports but the default. A bad allowlist entry bubbles.
let policy = UrlPolicy.fetch.withSubdomainsOf(["example.com"]) orelse panic();
policy.check("https://api.example.com/").url;  // the URL
policy.check("https://127.0.0.1/").toString(); // "specialHost: 127.0.0.1 is loopback (RFC 1122), in 127.0.0.0/8"
url.withoutCredentials(); // a Url without the username and password

// For people, never for decisions: Unicode hosts where browsers show them,
// and no credentials.
let shown = UrlDisplay.addressBar;
shown.format(parseUrl("https://user@xn--bcher-kva.example/") orelse panic()); // "https://bücher.example"
domainToDisplay("xn--pple-43d.com"); // "xn--pple-43d.com", since it's Cyrillic а and Latin pple
url.sameDocument(url.withHash("other")); // true: the same but for the fragment

// Where each part was written, for editors and linters.
let source = parseUrlSource(" https://EXAMPLE.com/a\tb") orelse panic();
source.hostSpan.asWritten; // "EXAMPLE.com", at 9, 11 long; source.url is for decisions
```

The [tour](demos/README.md) shows the same in each language, with
identical output.

## API

- `parseUrl(input, base?)`: the standard's URL parser, as `new URL()`
  in JavaScript: a `Url`, or it bubbles (throws) where the standard
  fails. `Url.parse(input, base?)` gives null instead, and
  `Url.canParse(input, base?)` only says whether it would parse.
- `checkUrl(input, base?)`: a `UrlCheck`, with the `url` (or null) and
  the standard's validation errors, each with its `name` (such as
  `invalid-URL-unit` or `host-invalid-code-point`) and `position`, in
  code points. Where parsing fails, the last error says why, but a
  `base` that isn't a URL bubbles, as in `parseUrl`. Most
  errors don't stop a URL from parsing, as browsers accept it. Parsing
  notes errors only when asked, so `parseUrl` is no slower for them.
  For strict mode, `strictErrors` are the ones it counts, and
  `strictUrl` is the URL only if there are none: every error but
  `invalid-URL-unit` for a code point a path, query, fragment, or opaque
  host keeps or escapes (such as a space, `|`, or `[`), and two of
  Hrefine's own, `IPv4-non-canonical` (`127.1`, `0x7f.1`, `2130706433`)
  and `domain-percent-encoded` (`%65vil.example`), which the standard
  doesn't count as errors (see the [plan](docs/plan.md), "Strict mode").
  Each error also has a `length`: one code point, a whole host or port,
  the stripped ends, or none at the end of the input.
- `Url`: the standard's getters, each a string, as in JavaScript:
  `href` (without credentials; see below), `origin`, `protocol`, `host`,
  `hostname`, `port`, `pathname`, `search`, and `hash`, and
  `username()` and `password()`, which are methods here, as is
  `hrefWithCredentials()`, so serializers that read getters and
  properties, such as Java's Jackson and C#'s `System.Text.Json`, leave
  the credentials out. Typed parts
  beside them: `scheme` (without the colon), `portNumber` (null where
  `port` is empty), and `hostKind` (`HostKind.domain`, `ipv4`, `ipv6`,
  `opaque`, or `empty`, or null without a host). And:
  - `url.resolve(ref)`: `ref` resolved against `url`, without parsing
    `url` again; it bubbles where that fails, and `url.tryResolve(ref)`
    gives null instead.
  - `url.sameOrigin(other)`: whether the two have the same origin;
    opaque origins (as for `data:` URLs) never do. And
    `url.sameDocument(other)`: whether they're the same but for the
    fragment (the standard's URL equals, excluding fragments). A default
    port, case, and dot segments are already gone from both.
  - `href`: the URL to hand on, store, or compare as text: the
    standard's serialization, run as if the username and password were
    empty. It has no credentials, by design, unlike JavaScript's
    `URL.href`, so passing it around can't leak them; a request that
    needed them fails to authenticate, which is loud and safe.
  - `hrefWithCredentials()`: the standard's `href` exactly, with the
    username and password. It contains credentials and other secrets:
    never log it, and use it only to send them deliberately.
  - `strictHref`: `href` with what RFC 3986 doesn't allow escaped (such
    as `|`, `^`, `{`, `}`, `[` and `]` outside IPv6 hosts, and a `%`
    without two hex digits), and escapes of letters, digits, `-`, `.`,
    `_`, and `~` decoded, as RFC 3986 normalizes them, for strict
    parsers such as Java's `URI`. It means the same URL: Hrefine and
    browsers read it back with every part the same once decoded. Like
    `href`, it has no credentials; `strictHrefWithCredentials()` has them.
  - `toString()`: redacted for logging. It gives the URL with the
    credentials (the username and password written in the URL; not
    cookies, as JavaScript's `fetch` means by the word) each masked as
    `***`, as `https://***:***@example.com/` (an empty one stays
    empty), so logs show there were some. `***` still parses, as a
    username of `***`, so a URL copied from a log won't authenticate.
    Hand on `href`, never `toString()`.
  - `==` in Temper (`eq` in other languages) compares whole URLs,
    `hrefWithCredentials()`, so credentials count; compare `href`s to
    leave them out. Other languages' own `==` compares objects, not
    URLs (see [Known limits by language](#known-limits-by-language)).
  - `url.withoutCredentials()`: the URL without its username and
    password, for when a `Url` is wanted.
  - The standard's setters, as methods that give a new `Url`:
    `withHref`, `withProtocol`, `withUsername`, `withPassword`,
    `withHost`, `withHostname`, `withPort`, `withPathname`,
    `withSearch`, and `withHash`, so `url.withHash("top")` is
    JavaScript's `url.hash = "top"` (and `withHref` keeps the
    credentials in the string it's given); and `withPortNumber`, beside
    `portNumber`, taking a number or null. As there, a value that can't be
    set leaves the URL as it was (or as far as the standard got: a host
    with a bad port sets only the host), and only `withHref` bubbles.
  - `url.searchParams`: the query as a new `UrlSearchParams` each time,
    and `url.withSearchParams(params)`: a `Url` with them as its query
    (none, if they're empty).
- `UrlSearchParams`: JavaScript's `URLSearchParams`, the standard's
  `application/x-www-form-urlencoded` list of names and values.
  `new UrlSearchParams(init?)` parses a query, with or without `?`, and
  `UrlSearchParams.fromEntries(pairs)` takes a list of Temper `Pair`s
  (as JavaScript's constructor takes pairs);
  `append`, `remove(name, value?)` (JavaScript's `delete`: it removes
  every pair with the name, or with the name and value), `get` (null if
  missing), `getAll`, `has(name, value?)`, `set`, and `sort` (by UTF-16
  code units, as in JavaScript) read and change it in place; `size`,
  `entries()` (Temper `Pair`s, as each language's own pairs), `keys()`,
  and `values()` list it; and `toString()` gives the query, as
  `q=a+b&page=2`.
- `UrlPolicy`: a policy, built once and checked against many URLs,
  starting from `UrlPolicy.fetch`, for URLs a server fetches on
  someone's behalf (`https` only, no credentials, no special hosts, only
  the default port, strict, and at most 8,192 code points), or `UrlPolicy.any` (no
  rules), each `with` method giving a new policy with one rule set,
  replacing what an earlier call to the same method set:
  `withStrict(true)`, `withMaxLength(n)` (of the input and
  `hrefWithCredentials()`), `withBase(url)` (for relative input),
  `withSchemes(list)`, `withCredentials(false)`, `withIpHosts(false)`,
  `withSpecialHosts(false)` (no private, loopback, link-local,
  multicast, IPv4-mapped, or other special addresses, by IANA's
  registries, nor `localhost` and the like, or an empty host),
  `withHosts(list)` (an allowlist of exact hosts, compared on the
  parsed host), `withSubdomainsOf(list)` (domains and the names under
  them; a host passes if either list allows it), `withPorts(list)`
  (ports allowed beside the scheme's default), `withSameOrigin(url)`,
  and `withPathOnly(true)` (only a path, query, or fragment on the base,
  for redirect targets). `UrlPolicy.fetch` allows only default ports.
  `withHosts`, `withSubdomainsOf`, and `withPorts` bubble on an entry
  that isn't a host or port (such as `example.com:443`,
  `https://example.com/`, `*.example.com`, or an empty one, or, for
  `withSubdomainsOf`, an address), so mistakes fail where the policy is
  built.
  `policy.check(input)` gives a `PolicyCheck`, with the `url` if it
  passed, or the first `rule` it failed (a `PolicyRule`, such as
  `PolicyRule.specialHost`) and a `reason`, which may name a host but
  never credentials, so it's safe to log; it never bubbles. See
  [policy](src/policy.temper.md) for each rule and the table of special
  addresses.
- `UrlDisplay`: a URL formatted for people, as browsers' address bars
  show it, never for security decisions or handing on. Start from
  `UrlDisplay.addressBar` (no credentials, as address bars leave them
  out, nor a path that's only `/`, hosts in Unicode where browsers would
  show them, and escapes of non-ASCII text decoded where that's safe),
  and change parts with `withCredentials(true)` (the username, and a
  password only as `***`), `withFragment(false)`, `withRootSlash(true)`
  (a lone `/` path),
  `withUnicodeHosts(false)`, and `withDecoding(false)`; then
  `display.format(url)`.
  `domainToDisplay(domain)` does a host alone: each label in Unicode
  only where browsers would show it, else `xn--`: code points allowed
  in identifiers, one script (or Latin with Chinese, Japanese, or
  Korean), no look-alikes of ASCII letters or whole-script look-alikes
  (such as Cyrillic `аррӏе`), and Chromium's other rules, from Unicode's
  script and security data. Hrefine doesn't yet check labels against
  popular domains, as Chromium does (see the [plan](docs/plan.md),
  "Display formatting").
- `parseUrlSource(input, base?)`: a `UrlSource`, with the input
  `asWritten`, the parsed `url`, and where each part was written:
  `schemeSpan`, `usernameSpan`, `passwordSpan`, `hostSpan`, `portSpan`,
  `pathSpan`, `querySpan`, and `fragmentSpan`, each a `SourceSpan`
  (`start`, `length`, in code points of the input as given, and
  `asWritten`), or null where the input didn't write that part. For
  editors and linters: the text as written isn't normalized or checked,
  so never use it for security decisions; use `url`. It may contain
  credentials and other secrets, so don't log it.
- `parseHost(input)`: checks a host, as in `https://input/`, giving a
  `Host` with its `kind` and `serialized` form, or bubbles.
- `domainToAscii(domain)` and `domainToUnicode(domain)`: the standard's
  domain to ASCII and to Unicode (IDNA), as in Node's `url` module, for
  converting and showing names. They aren't checks: domain to ASCII
  passes `exa mple.com`, `0x7f.1`, and `[::1]` as they are, as the
  standard says. Use `parseHost` to check a host. Where the standard's
  algorithm fails, as for a lone zero-width joiner, `domainToAscii`
  bubbles, where Node's gives `""`.

`Url` is immutable, unlike JavaScript's `URL`, so a URL that passed a
check can't change after, and threads can share it (but see Lua and C++
below). So the setters give a new `Url`, and the search
parameters aren't tied to a URL: JavaScript's `url.searchParams.append(…)`
is two steps here, reading `searchParams` and handing them back with
`withSearchParams`.

Every language gets these names in its own style (`parse_url` and
`url.host_kind` in Python and Rust, `ParseUrl` and `url.HostKind` in C#,
`getHref()` and `hrefWithCredentials()` in Java); see the tour for
each.

### Known limits by language

Temper doesn't yet carry everything over to each language. In all of
them, the language's own `==` compares objects, not URLs, so use `eq`
(`Eq` in C#), and nothing hashes a `Url` by value. And:

| Language | As a string | Also |
|---|---|---|
| C++ | `url->toString()`; `<<` doesn't take a `Url` | Fields are public and writable, so nothing is immutable, and the header shows every internal. Constructors are public, so a `Url` or a passing `PolicyCheck` needn't come from the library. A missing number is Temper's `NullableParam`, with `has_value`. |
| C# | `ToString()` and `$"{url}"` mask credentials | Functions are on `HrefineGlobal`. Constructors are public. |
| Java | `toString()` and `+` mask credentials | Functions are on `HrefineGlobal`. Gson, which reads fields, writes the credentials; Jackson, which reads getters, doesn't. |
| JavaScript | `toString()` and templates mask credentials | Constructors are public. |
| Lua | `url:toString()`; `tostring(url)` gives a table | A missing value is `temper.null`, a table, so it's truthy: `if Url.parse(input) then` passes for every input. Use `temper.null_to_nil(…)`, or a check's `passed`. Fields are writable, so nothing is immutable, and `pairs(url)` lists the password. Constructors are public. |
| Python | `str(url)` masks credentials | Arguments are positional only (`base=` fails). Constructors are public. |
| Rust | `url.to_string()`; `Url` has no `Display` | `None::<&str>` for no base, and `.as_str()` to compare parts. |

### Coming from JavaScript's `URL`

The names are the WHATWG `URL` API's, but for one, deliberately: its
`href` has the username and password, and Hrefine's doesn't. Where
JavaScript code reads `url.href`, Hrefine's `href` is usually what's
meant, since few URLs carry credentials; where it must send them, use
`hrefWithCredentials()`, which is easy to search for in review. And
`username()` and `password()` are methods, not getters, so serializers
that read getters and properties leave the credentials out. In short:

- `href`, to hand on, store, or compare as text;
- `withoutCredentials()`, for a `Url` without them;
- `hrefWithCredentials()`, only to send credentials deliberately;
- `toString()`, for logs.

## Using it safely

Hrefine doesn't change how other code reads URLs: `fetch`, `requests`,
`HttpClient`, and the rest keep their own parsers. So decide with
Hrefine, then hand on its `href`, never the original string:

```temper
let url = Url.parse(input);
if (
  url != null && url.scheme == "https" && url.hostKind == HostKind.domain &&
    isAllowed(url.hostname) // your check
) {
  fetchUrl(url.href); // your HTTP client, given href, not input
}
```

`hostKind` says whether the host is a name or an address, however the
address is written (`0x7f.1` is `127.0.0.1`), so an allowlist of names
can't be met by an address. To redirect to a user's `next` parameter,
resolve it against your own site, and check `sameOrigin`:

```temper
let next = site.tryResolve(param);
if (next != null && next.sameOrigin(site)) { redirectTo(next.href) }
```

Or let a policy do it all in one call, built once, with the rules
people tend to miss by hand: no credentials (`good.example@evil.example`),
no private or loopback addresses however they're written (`127.1`,
`[::ffff:127.0.0.1]`, `localhost.`), and no ports but the default
(`:6379`). `UrlPolicy.fetch` has those, with `https` only and strict
mode. Add your allowlist: `withHosts` for exact hosts, and
`withSubdomainsOf` for domains and the names under them. Each bubbles
on an entry that isn't a host, such as `example.com:443` or
`*.example.com`, rather than letting it match nothing, and each call
replaces its list, not adds to it. `withPorts` allows more ports.

```temper
let fetchPolicy = UrlPolicy.fetch.withSubdomainsOf(["example.com"]) orelse panic();
let checked = fetchPolicy.check(input);
if (checked.url != null) { fetchUrl(checked.url.href) } else { log(checked.toString()) }

let redirects = UrlPolicy.any.withBase(site).withPathOnly(true);
```

A policy can't see where DNS sends a name, so against SSRF, also check
the address your client connects to, and check or turn off redirects.

Keep credentials out of logs: `href` has none, and `url.toString()`
masks them, showing that there were some; or log a policy's `reason`.
Never log `hrefWithCredentials()` or the input. If a request needs the
credentials in the URL, send `hrefWithCredentials()` deliberately; handed
`href`, it fails to authenticate rather than leaking them. Hrefine can't tell which query parameters or fragments hold
secrets (`?token=`, `#access_token=`), so don't log URLs that may carry
tokens there; a masking helper is a possible addition (see the
[plan](docs/plan.md), "Credentials").

`href` is the standard's canonical form: backslashes become slashes,
tabs and newlines are gone, hosts are lowercased and in ASCII (`127.1`
becomes `127.0.0.1`, international names become Punycode), and dot
segments are resolved. Most of what makes parsers disagree is gone, so
other parsers, browsers' and servers' alike, read it as Hrefine did.
For clients that follow RFC 3986 strictly, such as Java's `URI`, hand on
`strictHref`, which escapes the few characters `href` leaves that RFC
3986 doesn't allow; on the site's recorded URLs, every parser reads it
as browsers read the original.

## Tests

The tests are [web-platform-tests](https://github.com/web-platform-tests/wpt)'
own URL cases, the ones browsers are checked against, vendored in
[tests/wpt](tests/wpt) at a pinned commit (see [NOTICE](NOTICE)):

- `urltestdata.json`: 896 inputs, with bases, that must parse to given
  values for each part, or must fail. `scripts/wpt_tests.py` turns them
  into [a Temper test](src/wpt-url-tests.temper.md). All pass on every
  backend.
- `toascii.json` and `IdnaTestV2.json`: 87 and 2,675 international domain
  names, each with the host it must give, or none if it must fail.
  `scripts/wpt_idna_tests.py` turns them into [a Temper
  test](src/wpt-idna-tests.temper.md), which parses each as a URL's
  host, as web-platform-tests does. All pass on every backend, but for 2
  that Temper strings can't hold (unpaired surrogates), which are left
  out. The tests and the IDNA tables are both for Unicode 18.0.
- `setters_tests.json`: 278 URLs, each with one part set, and the parts
  that must follow. `scripts/wpt_setter_tests.py` turns them into [a
  Temper test](src/wpt-setter-tests.temper.md), calling the matching
  `with` method. All pass on every backend.
- `urlencoded-parser.any.js` and `urlsearchparams-sort.any.js`: 35
  queries and the names and values they must give, and 8 to sort, which
  `scripts/wpt_search_params_tests.py` turns into [a Temper
  test](src/wpt-search-params-tests.temper.md) (with Node, since they're
  JavaScript). The other `urlsearchparams-*.any.js` files and
  `url-searchparams.any.js` are ported by hand into
  [search-params](src/search-params.temper.md)'s tests, but for what
  tests JavaScript's own conversions (`null` and numbers as names). All
  pass on every backend.
- `percent-encoding.json`: 7 inputs and how a query and fragment must
  escape them, ported by hand into [strict](src/strict.temper.md)'s
  tests. Only the UTF-8 answers apply; the rest are for pages in legacy
  encodings, which the `URL` API never uses.

[Display](src/display.temper.md)'s tests try names in many scripts
that browsers show in Unicode, and spoofs and other labels they don't
(each rule: restricted code points, mixed scripts and numbers,
whole-script and digit look-alikes, Latin look-alikes of ASCII letters,
Chromium's dangerous patterns, and its rules for `ß`, `þ`, `ð`, `ə`, and
`·`, each checked against Chromium's source), all hand-written,
since neither browser's IDN test data is in web-platform-tests; and
decoding for display, checking that each display form parses back to the
same `href`. [Source](src/source.temper.md)'s tests try spans through
stripped spaces, controls, tabs, and newlines, and against a base.

[Policy](src/policy.temper.md)'s tests try every rule and strict mode
on the classic bypasses (`127.1`, `0x7f.1`, `[::ffff:127.0.0.1]`,
`2130706433`, `localhost.`, user info, backslashes and tabs, and IDNA
look-alikes), and on the site's recorded inputs.

Each URL from `urltestdata.json` and `setters_tests.json` also checks
`strictHref`: it must be RFC 3986, by the grammar, and parse back to the
same parts once decoded. Their expected `href` is the standard's, so it's
checked against `hrefWithCredentials()`, and `href` and `strictHref` must
be the same without the credentials.

## Site

[The site](site/) shows the problem and the fix in one page: one URL that
other languages' parsers read as different hosts, a tester that parses
whatever you type live with Hrefine's JavaScript build (beside your
browser's own `URL`, with how browsers would show it, how `toString`
logs one with credentials, and each
validation error marked in the input), a gallery of tricks (short and hex IPv4 forms,
backslashes, `@` and `#@`, tabs, look-alike Unicode, `javascript:`, and
protocol-relative URLs), a table of 48 more disagreements, by kind
(backslashes and controls, user info, IPv4 and IPv6 forms, escaped and
international names, schemes and ports, and paths), and the fix in each
language, taken from the tours.

Other parsers can't run in a browser, so their answers for the 62
recorded URLs are recorded ahead of time, with their versions and the date:
Python's `urllib.parse`, Java's `URI` and `URL`, .NET's `Uri`, Go's
`net/url`, libcurl's URL API, and Node's `URL`, standing in for browsers.
`site/record/record.py` runs each one that's installed on the inputs in
`site/gallery.json`, then on Hrefine's full forms of each,
`hrefWithCredentials()` and `strictHrefWithCredentials()` (the exact URL,
since some tricks are in the user info), and writes `site/recorded.json`, which is checked in. Each parser counts
as agreeing with browsers if it reads the same host (IPv6 addresses
compared as addresses), or for path tricks the same path. Given
`strictHref`, every recorded parser agrees on every URL Hrefine
accepts, but for Java's `URL` and curl refusing `javascript:`; given
`href`, Java's `URI`, Go, and C# still miss a few paths (see the
[plan](docs/plan.md), step 6). The build fails unless browsers read
each strict form as they read its `href`. The table's inputs come
from web-platform-tests' cases and published research on parser
differences; keep it curated, with a short note on each. Re-record after changing the
gallery, or to update the versions:

    temper build -b js -b py
    uv run site/record/record.py

A scoreboard runs web-platform-tests' URL cases (`urltestdata.json`)
in the visitor's browser, through its own `URL` and through Hrefine,
lazily, once the section is near, and lists each miss. It counts as
Hrefine's own test does (each case must fail, or give the expected
`href` and every part), leaving out cases with unpaired surrogates, of
which this file has none. `site/scoreboard.js` holds the scoring, and the
build runs the same module in Node (`site/scoreboard-node.mjs`), showing
Node's score, with that Node's version, beside the visitor's, and failing
unless Hrefine passes every case. It warns if that Node isn't the one in
`recorded.json`.

Build the site, with Temper, Python, and Node 24 or later, and preview
it:

    temper build -b js
    uv run site/build.py
    python3 -m http.server --bind 127.0.0.1 -d site/build

The build copies the JS library and Temper's runtime as plain ES modules
(no bundler, so about 80 KB gzipped), renders the opening, the gallery,
and the table from the recorded answers (each table row's full answers go
in `tables.json`, which the tester fetches only when one is tried), and takes the fix's code from each tour's
"Using it safely" section, failing if it can't find it. It also runs the
JavaScript tour in Node as the page's "Run in your browser" does
(`site/tourrun.js`, shared by both), failing unless it prints what every
tour prints.

A "Show the code" switch puts badges on the parts of the page with code
behind them (`site/devmode.js`), each opening a short snippet in any of
the seven languages. The snippets are lines of the tours marked with a
comment such as `# snippet: hero, parts`; the build collects them into
`snippets.json`, failing if one is missing from a tour or a badge has
none, and strips the markers from the tours the page shows. It also
checks each name on a card, as each language spells it, against that
language's tour (`site/spell-node.mjs`). CI runs every tour, so every
snippet runs. Visits are counted
by cookieless GoatCounter, site code `hrefine`. CI
(`.github/workflows/site.yml`) builds the site on every change and
publishes it to GitHub Pages from `main`.

## Languages

Made in Temper, it will support these languages, and its tests run on
each:

- C++
- C\#
- Java
- JavaScript
- Lua
- Python
- Rust

## Speed and size

`bench/` times Hrefine on the same inputs in every language: 50 URLs
(`bench/urls.txt`: mostly ASCII, some against a base, IPv4 and IPv6
hosts, percent-encoding, nine international hosts, and three that must
fail) and 12 domains to convert to ASCII (`bench/domains.txt`). Each
program in `bench/<language>/` first checks its results against
`bench/expected.txt` (which match Node's `URL`), then reports the
library's load time, the first domain beyond ASCII, and steady-state
nanoseconds per URL and per domain; the script also measures the
generated library without tests, raw and gzipped. One command builds
and runs it all, five runs per language:

    uv run bench/run.py [LANGUAGE ...]

Medians on a busy laptop (2026-10-29), so rough:

| Language | Load | First IDNA | Parse | IDNA | Size (gzipped) |
|---|---|---|---|---|---|
| C++ | 0.15 ms | 0.006 ms | 6.6 µs | 2.7 µs | 225 KB (43 KB) |
| C# | 4.4 ms | 11 ms (JIT) | 4.7 µs | 4.6 µs | 238 KB (41 KB) |
| Java | 4.1 ms | 0.45 ms | 7–15 µs | 1.6 µs | 201 KB (40 KB) |
| JavaScript | 4.4 ms | 0.9 ms | 5.9 µs | 5.9 µs | 157 KB (40 KB) |
| Lua | 3.9 ms | 0.11 ms | 113 µs | 132 µs | 160 KB (40 KB) |
| Python | 1.6 ms | 0.13 ms | 106 µs | 154 µs | 163 KB (39 KB) |
| Rust | 0.08 ms | 0.009 ms | 7.2 µs | 4.9 µs | 248 KB (45 KB) |

Load is after Temper's own runtime, which takes another 30–40 ms to
import in Python. The API revision after the tours (`checkUrl`, typed
parts, and `parseHost`) left parsing as fast, timed in turns, and added
about 21–23 KB (4 KB gzipped) in Python and JavaScript. The [plan](docs/plan.md) has what changed these.
The table predates the setters and search parameters (2026-10-30),
which add code, and a few checks to the parser for the setters' state
overrides; they aren't measured yet.

## Roadmap

See the [plan](docs/plan.md) for details.

- **Done:** parsing and serializing, international domain names (IDNA),
  setters and search parameters, the strict RFC 3986 form, strict mode
  and policies, display formatting (with Unicode's script and security
  data), comparison, source spans, the
  tours, and the site.
- **Next:** lossless editing, designed in the
  plan, once its span and edit model is settled with a lossless
  Markdown and HTML library.
- **Before 1.0:** trademark checks, a minified site bundle, and
  publishing packages.

## Development

Written with Claude Code and Opus 5.5.

Run tests with [Temper](https://temperlang.dev/), on one backend while
working:

    temper test -b py

Or on all of them:

    temper test -b cpp -b csharp -b java -b js -b lua -b py -b rust

Run the tour in every language against `temper.out/`, checking each
prints the same text (see [demos](demos/README.md)):

    uv run demos/run.py

CI runs the tests and the tour on every backend for pull requests and
pushes to `main`, using Temper's nightly `dev` build.

Regenerate the tests from web-platform-tests' data, and the IDNA tables
from Unicode's (which `scripts/unicode_data.py` downloads and checks):

    uv run scripts/wpt_tests.py
    uv run scripts/wpt_idna_tests.py
    uv run scripts/wpt_setter_tests.py
    uv run scripts/wpt_search_params_tests.py
    uv run scripts/idna_tables.py
    uv run scripts/display_tables.py

## License

Apache-2.0 OR MIT, at your option, as Temper is; see [COPYRIGHT](COPYRIGHT). Third-party material, with its notices, is in [NOTICE](NOTICE).
