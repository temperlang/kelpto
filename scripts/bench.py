# /// script
# requires-python = ">=3.11"
# ///
"""Benchmarks kelpto-md against each language's usual Markdown parsers.

Usage, from anywhere in the repo, after building the libraries:

    temper build -b cpp -b csharp -b java -b js -b lua -b py -b rust
    uv run scripts/bench.py [LANGUAGE ...] [--rounds N] [--quick]
    uv run scripts/bench.py --summary bench/results/DATE.json

Builds each `bench/<language>/` project, makes the inputs, then times every
library on every input in each language, once per round, and writes
`bench/results/<date>.json` and a summary, `bench/results/<date>.md`. A run
of some languages replaces just those in the day's file. See
bench/README.md.
"""

import argparse
import contextlib
import datetime
import fcntl
import json
import math
import os
import platform
import re
import statistics
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BENCH = ROOT / "bench"
INPUTS = BENCH / "build" / "inputs"
RESULTS = BENCH / "results"
DOCS = ROOT / "tests" / "samples" / "docs"

# Each language: its directory, build commands, worker command, and the
# libraries it compares, kelpto-md first. Workers take `time PLAN` or
# `mem LIBRARY TASK FILE`.
LANGUAGES = {
    "cpp": {
        "dir": "bench/cpp",
        "build": [
            ["cmake", "-B", "build", "-DCMAKE_BUILD_TYPE=Release"],
            ["cmake", "--build", "build", "-j", "2"],
        ],
        "run": ["./build/bench"],
        "libraries": ["kelpto", "cmark"],
    },
    "csharp": {
        "dir": "bench/csharp",
        # No build servers, which would stay running after.
        "build": [
            ["dotnet", "build", "-c", "Release", "-v", "q", "--nologo", "-nodeReuse:false",
             "-p:UseSharedCompilation=false"],
        ],
        "run": ["dotnet", "bin/Release/net6.0/Bench.dll"],
        "after": [["dotnet", "build-server", "shutdown"]],
        "libraries": ["kelpto", "markdig"],
        "warmup_ms": 1000,
    },
    "java": {
        "dir": "bench/java",
        "build": [["./gradlew", "-q", "--no-daemon", "installDist"]],
        "run": ["build/install/kelpto-bench/bin/kelpto-bench"],
        "libraries": ["kelpto", "commonmark-java", "flexmark"],
        "warmup_ms": 1000,
    },
    "js": {
        "dir": "bench/js",
        # ci, not install: it re-copies the generated library after a rebuild.
        "build": [["npm", "ci", "--silent", "--no-audit", "--no-fund"]],
        "run": ["node", "--expose-gc", "bench.js"],
        "libraries": ["kelpto", "commonmark.js", "markdown-it"],
        "warmup_ms": 1000,
    },
    "lua": {
        "dir": "bench/lua",
        "build": [],
        "run": ["lua", "bench.lua"],
        "libraries": ["kelpto"],
    },
    "py": {
        "dir": ".",
        "build": [["uv", "sync", "-q", "--group", "bench"]],
        "run": [".venv/bin/python", "bench/py/bench.py"],
        "libraries": ["kelpto", "markdown-it-py", "mistune"],
    },
    "rust": {
        "dir": "bench/rust",
        "build": [["cargo", "build", "-q", "--release"]],
        "run": ["target/release/bench"],
        "libraries": ["kelpto", "pulldown-cmark", "comrak"],
    },
}

NAMES = {"cpp": "C++", "csharp": "C#", "java": "Java", "js": "JavaScript", "lua": "Lua", "py": "Python", "rust": "Rust"}

# Real documents, then a long one: the spec ten times, about 2 MB.
DOCUMENTS = ["commonmark-spec", "chromarite-readme", "hrefine-readme", "kelpto-readme", "ordable-readme"]
LONG = "spec-x10"

# Some of cmark's pathological shapes (from its test/pathological_tests.py),
# each at n, 2n, 4n, and 8n from the n given. A parser linear in the input
# takes twice as long when the input doubles. Nested lists grow as n
# squared, since each line is indented further.
SHAPES = {
    "emph-openers": (lambda n: "_a " * n, 4000),
    "emph-closers": (lambda n: "a_ " * n, 4000),
    "mismatched-emph": (lambda n: "*a_ " * n, 4000),
    "link-openers": (lambda n: "[a" * n, 4000),
    "unclosed-links": (lambda n: "[a](<b" * n, 4000),
    "brackets-parens": (lambda n: "[ (](" * n, 4000),
    "nested-brackets": (lambda n: "[" * n + "a" + "]" * n, 4000),
    "nested-block-quotes": (lambda n: "> " * n + "a", 100),
    "nested-lists": (lambda n: "".join("  " * i + "* a\n" for i in range(n)), 32),
}
SCALES = [1, 2, 4, 8]

TASKS = ["parse", "render"]
KELPTO_TASKS = ["walk", "transform"]


def make_inputs(quick):
    """Writes the inputs, giving (name, path, bytes, group) for each."""
    INPUTS.mkdir(parents=True, exist_ok=True)
    inputs = []
    for name in DOCUMENTS:
        path = DOCS / f"{name}.md"
        inputs.append((name, path, path.stat().st_size, "document"))
    spec = (DOCS / "commonmark-spec.md").read_bytes()
    if not quick:
        path = INPUTS / f"{LONG}.md"
        path.write_bytes(spec * 10)
        inputs.append((LONG, path, path.stat().st_size, "document"))
    for shape, (make, base) in SHAPES.items():
        for n in (base * scale for scale in (SCALES[:2] if quick else SCALES)):
            name = f"{shape}-{n}"
            path = INPUTS / f"{name}.md"
            path.write_text(make(n), encoding="utf-8")
            inputs.append((name, path, path.stat().st_size, "pathological"))
    return inputs


def plan_jobs(language, inputs):
    """Every job, as (library, task, input name), libraries back to back."""
    libraries = LANGUAGES[language]["libraries"]
    jobs = []
    for name, _, _, group in inputs:
        tasks = TASKS + KELPTO_TASKS if group == "document" else ["parse"]
        for task in tasks:
            for library in libraries:
                if task in TASKS or library == "kelpto":
                    jobs.append((library, task, name))
    return jobs


@contextlib.contextmanager
def locked(lock):
    """Holds an exclusive flock on `lock`, if given, keeping other heavy jobs out."""
    if lock is None:
        yield
        return
    with open(lock, "a") as file:
        fcntl.flock(file, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(file, fcntl.LOCK_UN)


def environment():
    env = dict(os.environ)
    env.setdefault("CARGO_BUILD_JOBS", "2")
    env["DOTNET_CLI_TELEMETRY_OPTOUT"] = "1"
    env["DOTNET_NOLOGO"] = "1"
    return env


def build(language, lock):
    config = LANGUAGES[language]
    for args in config["build"]:
        with locked(lock):
            result = subprocess.run(args, cwd=ROOT / config["dir"], capture_output=True, text=True, env=environment())
        if result.returncode != 0:
            raise RuntimeError(f"{' '.join(args)} failed:\n{result.stderr}{result.stdout}")
    after(language)


def after(language):
    for args in LANGUAGES[language].get("after", []):
        subprocess.run(args, cwd=ROOT / LANGUAGES[language]["dir"], capture_output=True, env=environment())


def run_worker(language, args, lock):
    """Runs a worker, giving its output, its errors, and whether it succeeded."""
    config = LANGUAGES[language]
    with locked(lock):
        result = subprocess.run(
            config["run"] + args, cwd=ROOT / config["dir"], capture_output=True, text=True, env=environment()
        )
    return result.stdout, result.stderr, result.returncode == 0


def peak_memory(language, library, task, path, lock):
    """Peak resident memory, in KiB, of one worker doing one task once."""
    config = LANGUAGES[language]
    with locked(lock):
        process = subprocess.Popen(
            config["run"] + ["mem", library, task, str(path)],
            cwd=ROOT / config["dir"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            env=environment(),
        )
        _, status, usage = os.wait4(process.pid, 0)
    if status != 0:
        raise RuntimeError(f"{language} {library} {task} failed: {process.stderr.read().decode()}")
    return usage.ru_maxrss


def time_language(language, inputs, settings, lock):
    """One round: every job in one worker process, back to back.

    A job that fails (deep nesting can overflow a stack) is recorded with
    its error, and a new worker goes on with the rest.
    """
    paths = {name: str(path) for name, path, _, _ in inputs}
    names = {str(path): name for name, path, _, _ in inputs}
    warmup = LANGUAGES[language].get("warmup_ms", settings["warmup_ms"])
    plan = BENCH / "build" / f"plan-{language}.tsv"
    jobs = plan_jobs(language, inputs)
    rows = []
    while jobs:
        lines = [f"{warmup} {settings['sample_ms']} {settings['samples']} {settings['budget_ms']}"]
        lines += [f"{library}\t{task}\t{paths[name]}" for library, task, name in jobs]
        plan.write_text("\n".join(lines) + "\n", encoding="utf-8")
        out, err, ok = run_worker(language, ["time", str(plan)], lock)
        after(language)
        done = 0
        for line in out.splitlines():
            fields = line.split("\t")
            if len(fields) != 6 or not fields[5]:
                break
            library, task, path, inner, check, times = fields
            rows.append({
                "library": library,
                "task": task,
                "input": names[path],
                "inner": int(inner),
                "check": int(check),
                # Four digits: more is noise.
                "seconds": [float(f"{float(t):.4g}") for t in times.split()],
            })
            done += 1
        jobs = jobs[done:]
        if ok:
            break
        if not jobs:
            raise RuntimeError(f"{language} worker failed after its last job:\n{err[-2000:]}")
        library, task, name = jobs.pop(0)
        messages = err.strip().splitlines() or ["(no message)"]
        error = next((m for m in messages if re.search(r"error|exception|panick|overflow", m, re.I)), messages[-1])
        error = error.strip()[:300]
        print(f"  {language} {library} {task} {name}: failed: {error}", file=sys.stderr, flush=True)
        rows.append({"library": library, "task": task, "input": name, "error": error})
    return rows


def dump(results):
    """JSON with each result row, and each list of numbers, on one line."""
    text = json.dumps(results, indent=1, ensure_ascii=False)
    text = re.sub(r"\[\s*([-+\d.e]+(?:,\s*[-+\d.e]+)*)\s*\]",
                  lambda m: "[" + ", ".join(re.split(r",\s*", m.group(1))) + "]", text)
    text = re.sub(r"\{\n\s*(\"library\"[^{}]*?)\n\s*\}",
                  lambda m: "{" + re.sub(r"\n\s*", " ", m.group(1)) + "}", text)
    return text + "\n"


def command_output(args, cwd=ROOT):
    try:
        result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, env=environment())
        return (result.stdout + result.stderr).strip().splitlines()[0]
    except (OSError, IndexError):
        return None


def machine():
    cpu = None
    with contextlib.suppress(OSError):
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.startswith("model name"):
                cpu = line.split(":", 1)[1].strip()
                break
    kernel = platform.release()
    where = "container" if Path("/.dockerenv").exists() else "WSL" if "microsoft" in kernel.lower() else "native"
    memory = None
    with contextlib.suppress(OSError):
        memory = round(int(Path("/proc/meminfo").read_text().split()[1]) / 1024 / 1024, 1)
    return {"cpu": cpu, "cores": os.cpu_count(), "memory_gib": memory, "kernel": kernel, "where": where}


def runtimes(languages):
    commands = {
        "cpp": ["c++", "--version"],
        "csharp": ["dotnet", "--version"],
        "java": ["java", "-version"],
        "js": ["node", "--version"],
        "lua": ["lua", "-v"],
        "py": [".venv/bin/python", "--version"],
        "rust": ["rustc", "--version"],
    }
    found = {language: command_output(commands[language]) for language in languages}
    found["temper"] = command_output(["temper", "version"])
    found["kelpto"] = command_output(["git", "describe", "--always", "--dirty"])
    return found


def packages(languages):
    """Each native library's version, from its project's lockfile."""
    found = {}
    if "cpp" in languages:
        match = re.search(r"cmark/archive/refs/tags/(\d+(?:\.\d+)*)", (BENCH / "cpp" / "CMakeLists.txt").read_text())
        found["cmark"] = match and match.group(1)
    if "csharp" in languages:
        lock = json.loads((BENCH / "csharp" / "packages.lock.json").read_text())
        for framework in lock["dependencies"].values():
            if "Markdig" in framework:
                found["markdig"] = framework["Markdig"]["resolved"]
    if "java" in languages:
        for line in (BENCH / "java" / "gradle.lockfile").read_text().splitlines():
            for library, coordinate in (("commonmark-java", "org.commonmark:commonmark:"),
                                        ("flexmark", "com.vladsch.flexmark:flexmark:")):
                if line.startswith(coordinate):
                    found[library] = line[len(coordinate):].split("=")[0]
    if "js" in languages:
        lock = json.loads((BENCH / "js" / "package-lock.json").read_text())["packages"]
        found["commonmark.js"] = lock["node_modules/commonmark"]["version"]
        found["markdown-it"] = lock["node_modules/markdown-it"]["version"]
    if "py" in languages:
        lock = tomllib.loads((ROOT / "uv.lock").read_text())
        for package in lock["package"]:
            if package["name"] in ("markdown-it-py", "mistune"):
                found[package["name"]] = package["version"]
    if "rust" in languages:
        lock = tomllib.loads((BENCH / "rust" / "Cargo.lock").read_text())
        for package in lock["package"]:
            if package["name"] in ("pulldown-cmark", "comrak"):
                found[package["name"]] = package["version"]
    return found


# Summaries.


def fmt_time(seconds):
    for unit, scale in (("s", 1), ("ms", 1e-3), ("µs", 1e-6)):
        if seconds >= scale:
            return f"{seconds / scale:.3g} {unit}"
    return f"{seconds / 1e-9:.3g} ns"


def fmt_ratio(ratio):
    return f"{ratio:.2g}" if ratio < 10 else f"{ratio:.0f}"


def gathered(results, language):
    """Samples by (library, task, input), over all rounds, and per round."""
    samples = {}
    for round_rows in results["languages"][language]["rounds"]:
        for row in round_rows:
            if "error" in row:
                continue
            samples.setdefault((row["library"], row["task"], row["input"]), []).append(row["seconds"])
    return samples


def round_ratios(kelpto_runs, native_runs):
    """Each round's ratio of medians, kelpto-md's over the other's."""
    return [statistics.median(a) / statistics.median(b) for a, b in zip(kelpto_runs, native_runs)]


def headline(results):
    """kelpto-md's time over each native library's, per language: in each
    round, the ratio of the two medians; the median of those, with the
    lowest and highest."""
    out = ["How many times longer kelpto-md takes than each language's usual parsers "
           "(each round's ratio of medians: the median round, and in brackets the lowest and highest).", ""]
    readmes = [name for name in DOCUMENTS if name != "commonmark-spec"]
    columns = [("parse", ["commonmark-spec"], "spec, parse"), ("render", ["commonmark-spec"], "spec, render"),
               ("parse", [LONG], f"{LONG}, parse"), ("parse", readmes, "READMEs, parse")]
    out.append("| Language | Against | " + " | ".join(label for _, _, label in columns) + " |")
    out.append("|" + "---|" * (2 + len(columns)))
    for language in LANGUAGES:
        if language not in results["languages"]:
            continue
        samples = gathered(results, language)
        for lib in LANGUAGES[language]["libraries"][1:]:
            cells = [NAMES[language], lib]
            for task, names, _ in columns:
                ratios, lows, highs = [], [], []
                for name in names:
                    a, b = ("kelpto", task, name), (lib, task, name)
                    if a not in samples or b not in samples:
                        continue
                    rounds = round_ratios(samples[a], samples[b])
                    ratios.append(statistics.median(rounds))
                    lows.append(min(rounds))
                    highs.append(max(rounds))
                if not ratios:
                    cells.append("")
                elif len(ratios) == 1:
                    cells.append(f"{fmt_ratio(ratios[0])} ({fmt_ratio(lows[0])} to {fmt_ratio(highs[0])})")
                else:
                    cells.append(f"{fmt_ratio(min(ratios))} to {fmt_ratio(max(ratios))} "
                                 f"({fmt_ratio(min(lows))} to {fmt_ratio(max(highs))})")
            out.append("| " + " | ".join(cells) + " |")
    out.append("")
    return out


def summary(results):
    out = [f"# Benchmarks, {results['date']}", ""]
    m = results["machine"]
    out.append(f"{m['cpu']}, {m['cores']} threads, {m['memory_gib']} GiB, in a {m['where']} "
               f"(Linux {m['kernel']}). {results['settings']['rounds']} rounds.")
    out.append("")
    sizes = {name: size for name, size, _ in results["inputs"]}
    groups = {name: group for name, _, group in results["inputs"]}
    out += headline(results)
    for language in LANGUAGES:
        if language not in results["languages"]:
            continue
        entry = results["languages"][language]
        libraries = LANGUAGES[language]["libraries"]
        natives = libraries[1:]
        samples = gathered(results, language)

        def median(key):
            return statistics.median(t for run in samples[key] for t in run)

        def spread(key):
            every = [t for run in samples[key] for t in run]
            return min(every), max(every)

        def ratio_range(kelpto_key, native_key):
            per_round = round_ratios(samples[kelpto_key], samples[native_key])
            return statistics.median(per_round), min(per_round), max(per_round)

        out.append(f"## {NAMES[language]}")
        out.append("")
        versions = ", ".join(f"{lib} {entry['packages'].get(lib, '?')}" for lib in natives)
        out.append(f"{entry['runtime']}" + (f"; {versions}" if versions else "") + ".")
        out.append("")
        documents = [name for name, _, group in results["inputs"] if group == "document"]
        header = ["Input", "Task", "kelpto-md"] + [f"vs {lib}" for lib in natives]
        out.append("| " + " | ".join(header) + " |")
        out.append("|" + "---|" * len(header))
        for name in documents:
            for task in TASKS + KELPTO_TASKS:
                key = ("kelpto", task, name)
                if key not in samples:
                    continue
                low, high = spread(key)
                cells = [f"{name} ({sizes[name] // 1000} KB)", task,
                         f"{fmt_time(median(key))} ({fmt_time(low)} to {fmt_time(high)})"]
                for lib in natives:
                    native = (lib, task, name)
                    if native in samples:
                        ratio, a, b = ratio_range(key, native)
                        cells.append(f"{fmt_ratio(ratio)}× ({fmt_ratio(a)} to {fmt_ratio(b)}), "
                                     f"{fmt_time(median(native))}")
                    else:
                        cells.append("")
                out.append("| " + " | ".join(cells) + " |")
        out.append("")
        # Linearity: time per doubling of the input over the pathological shapes.
        shapes = {}
        for name in sizes:
            if groups[name] == "pathological":
                shape, n = name.rsplit("-", 1)
                shapes.setdefault(shape, []).append((int(n), name))
        if shapes:
            out.append("Pathological inputs, parse: time at the largest size, and how much longer it takes "
                       "each time the input doubles (×2 is linear, ×4 quadratic).")
            out.append("")
            header = ["Shape (largest)"] + libraries
            out.append("| " + " | ".join(header) + " |")
            out.append("|" + "---|" * len(header))
            for shape, sized in shapes.items():
                sized.sort()
                cells = [f"{shape} ({sizes[sized[-1][1]] / 1000:.3g} KB)"]
                for lib in libraries:
                    # From the smallest to the largest size the library parsed.
                    done = [name for _, name in sized if (lib, "parse", name) in samples]
                    if len(done) < 2:
                        cells.append("fails" if not done else f"{fmt_time(median((lib, 'parse', done[0])))}, then fails")
                        continue
                    a, b = (lib, "parse", done[0]), (lib, "parse", done[-1])
                    growth = 2 ** (math.log2(median(b) / median(a)) / math.log2(sizes[done[-1]] / sizes[done[0]]))
                    cell = f"{fmt_time(median(b))}, ×{growth:.1f}"
                    if done[-1] != sized[-1][1]:
                        cell += f" (to {sizes[done[-1]] / 1000:.3g} KB, then fails)"
                    cells.append(cell)
                out.append("| " + " | ".join(cells) + " |")
            out.append("")
        failures = {}
        for round_rows in entry["rounds"]:
            for row in round_rows:
                if "error" in row:
                    failures.setdefault((row["library"], row["task"], row["error"]), set()).add(row["input"])
        if failures:
            out.append("Failed:")
            out.append("")
            for (library, task, error), names in sorted(failures.items()):
                shown = ", ".join(sorted(names, key=lambda name: (name.rsplit("-", 1)[0], sizes[name])))
                out.append(f"- {library} {task} {shown}: `{error}`")
            out.append("")
        if entry.get("memory"):
            out.append(f"Peak memory on {LONG} ({sizes[LONG] // 1000} KB), above a worker that only reads it "
                       f"({entry['memory']['baseline_kib'] // 1024} MiB):")
            out.append("")
            out.append("| Library | parse | render |")
            out.append("|---|---|---|")
            for lib in libraries:
                row = entry["memory"]["libraries"].get(lib, {})
                cells = [f"{max(0, row[t] - entry['memory']['baseline_kib']) / 1024:.0f} MiB" if t in row else ""
                         for t in TASKS]
                out.append(f"| {lib} | " + " | ".join(cells) + " |")
            out.append("")
    return "\n".join(out)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("languages", nargs="*", metavar="LANGUAGE", help=", ".join(LANGUAGES))
    parser.add_argument("--rounds", type=int, default=3, help="whole runs of each language (default 3)")
    parser.add_argument("--samples", type=int, default=7, help="most timed samples per job (default 7)")
    parser.add_argument("--quick", action="store_true", help="small inputs and one short round, to check it all works")
    parser.add_argument("--no-build", action="store_true", help="skip building the bench projects")
    parser.add_argument("--no-memory", action="store_true", help="skip peak memory")
    parser.add_argument("--lock", help="a file to hold an exclusive flock on while building and timing")
    parser.add_argument("--out", help="results file (default bench/results/<date>.json)")
    parser.add_argument("--summary", metavar="RESULTS", help="print the summary of a results file and stop")
    args = parser.parse_args()
    if args.summary:
        print(summary(json.loads(Path(args.summary).read_text(encoding="utf-8"))))
        return
    languages = args.languages or list(LANGUAGES)
    unknown = set(languages) - set(LANGUAGES)
    if unknown:
        parser.error(f"unknown: {', '.join(sorted(unknown))}")
    settings = {
        "warmup_ms": 300,
        "sample_ms": 100,
        "samples": args.samples,
        "budget_ms": 3000,
        "rounds": args.rounds,
    }
    if args.quick:
        settings.update(warmup_ms=50, sample_ms=20, samples=3, budget_ms=300, rounds=1)
    started = datetime.datetime.now(datetime.timezone.utc)
    date = started.date().isoformat()
    out_path = Path(args.out) if args.out else RESULTS / f"{date}.json"
    if out_path.exists():
        results = json.loads(out_path.read_text(encoding="utf-8"))
    else:
        results = {"date": date, "languages": {}}
    inputs = make_inputs(args.quick)
    failed = []
    if not args.no_build:
        for language in list(languages):
            print(f"building {language}", file=sys.stderr, flush=True)
            try:
                build(language, args.lock)
            except (RuntimeError, OSError) as error:
                print(f"{language}: build failed\n{error}", file=sys.stderr)
                failed.append(language)
                languages.remove(language)
    rounds = {language: [] for language in languages}
    for round in range(settings["rounds"]):
        for language in list(languages):
            print(f"round {round + 1}: {language}", file=sys.stderr, flush=True)
            try:
                rounds[language].append(time_language(language, inputs, settings, args.lock))
            except (RuntimeError, OSError) as error:
                print(f"{language}: failed\n{error}", file=sys.stderr)
                failed.append(language)
                languages.remove(language)
    long_path = next((path for name, path, _, _ in inputs if name == LONG), None)
    found_runtimes = runtimes(languages)
    found_packages = packages(languages)
    for language in languages:
        memory = None
        if long_path and not args.no_memory:
            print(f"memory: {language}", file=sys.stderr, flush=True)
            try:
                memory = {
                    "baseline_kib": peak_memory(language, "none", "read", long_path, args.lock),
                    "libraries": {
                        library: {task: peak_memory(language, library, task, long_path, args.lock) for task in TASKS}
                        for library in LANGUAGES[language]["libraries"]
                    },
                }
            except (RuntimeError, OSError) as error:
                print(f"{language}: memory failed\n{error}", file=sys.stderr)
            after(language)
        results["languages"][language] = {
            "runtime": found_runtimes[language],
            "packages": found_packages,
            "rounds": rounds[language],
            "memory": memory,
        }
    results.update(
        date=date,
        started=started.isoformat(timespec="seconds"),
        finished=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        machine=machine(),
        settings=settings,
        temper=found_runtimes["temper"],
        kelpto=found_runtimes["kelpto"],
        inputs=[(name, size, group) for name, _, size, group in inputs],
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(dump(results), encoding="utf-8")
    text = summary(results)
    out_path.with_suffix(".md").write_text(text + "\n", encoding="utf-8")
    print(text)
    print(f"\nWrote {out_path.relative_to(ROOT) if out_path.is_relative_to(ROOT) else out_path}", file=sys.stderr)
    if failed:
        print(f"Failed: {' '.join(failed)}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
