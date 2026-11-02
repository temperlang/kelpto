//! Times Markdown parsers in Rust, for scripts/bench.py.
//!
//!     target/release/bench time PLAN
//!     target/release/bench mem LIBRARY TASK FILE
//!
//! See ../README.md for the plan format and what each task does.

use std::collections::HashMap;
use std::hint::black_box;
use std::sync::Arc;
use std::time::Instant;

use kelpto_md::{Heading, MarkdownParser, MarkdownRenderer};
use temper_core::cast;

type Op = Box<dyn Fn(&Arc<String>) -> usize>;

fn kelpto_tasks() -> HashMap<&'static str, Op> {
    let mut tasks: HashMap<&'static str, Op> = HashMap::new();
    tasks.insert("parse", Box::new(|text| MarkdownParser::common_mark().parse(text.clone()).span().end() as usize));
    let renderer = MarkdownRenderer::new(None).with_raw_html_trusted();
    tasks.insert("render", Box::new(move |text| renderer.render(MarkdownParser::common_mark().parse(text.clone())).len()));
    tasks.insert(
        "walk",
        Box::new(|text| {
            let doc = MarkdownParser::common_mark().parse(text.clone());
            let views = doc.descendants();
            let mut headings = 0;
            for view in views.iter() {
                if cast::<Heading>(view.clone()).is_some() {
                    headings += 1;
                }
            }
            views.len() + headings + doc.as_written().len()
        }),
    );
    tasks.insert(
        "transform",
        Box::new(|text| {
            let doc = MarkdownParser::common_mark().parse(text.clone());
            let editor = doc.editor();
            for heading in doc.headings().iter() {
                let level = heading.level();
                if level < 6 && !(level == 2 && heading.style().as_str() == "setext") {
                    editor.set_level(heading.clone(), level + 1).expect("a level from 1 to 6");
                }
            }
            editor.to_document().expect("no overlapping edits").as_written().len()
        }),
    );
    tasks
}

fn pulldown_tasks() -> HashMap<&'static str, Op> {
    use pulldown_cmark::{html, Options, Parser};
    let mut tasks: HashMap<&'static str, Op> = HashMap::new();
    // A pull parser: parsing is reading every event; it builds no tree.
    tasks.insert("parse", Box::new(|text| Parser::new_ext(text, Options::empty()).count()));
    tasks.insert(
        "render",
        Box::new(|text| {
            let mut out = String::with_capacity(text.len() * 3 / 2);
            html::push_html(&mut out, Parser::new_ext(text, Options::empty()));
            out.len()
        }),
    );
    tasks
}

fn comrak_tasks() -> HashMap<&'static str, Op> {
    use comrak::{format_html, parse_document, Arena, Options};
    fn options() -> Options<'static> {
        let mut options = Options::default();
        // Raw HTML passes through, as in the others here.
        options.render.r#unsafe = true;
        options
    }
    let mut tasks: HashMap<&'static str, Op> = HashMap::new();
    tasks.insert(
        "parse",
        Box::new(|text| {
            let arena = Arena::new();
            let root = parse_document(&arena, text, &options());
            root.children().count()
        }),
    );
    tasks.insert(
        "render",
        Box::new(|text| {
            let arena = Arena::new();
            let options = options();
            let root = parse_document(&arena, text, &options);
            let mut out = String::new();
            format_html(root, &options, &mut out).expect("rendered");
            out.len()
        }),
    );
    tasks
}

fn library(name: &str) -> HashMap<&'static str, Op> {
    match name {
        "kelpto" => kelpto_tasks(),
        "pulldown-cmark" => pulldown_tasks(),
        "comrak" => comrak_tasks(),
        "none" => {
            let mut tasks: HashMap<&'static str, Op> = HashMap::new();
            tasks.insert("read", Box::new(|text| text.len()));
            tasks
        }
        _ => panic!("unknown library {name}"),
    }
}

fn read(path: &str) -> Arc<String> {
    Arc::new(std::fs::read_to_string(path).expect("readable"))
}

fn measure(op: &Op, text: &Arc<String>, warmup_ms: f64, sample_ms: f64, samples: usize, budget_ms: f64) -> (Vec<f64>, usize, usize) {
    let mut count = 0;
    let mut check;
    let start = Instant::now();
    let elapsed = loop {
        check = black_box(op(text));
        count += 1;
        let elapsed = start.elapsed().as_secs_f64();
        if elapsed * 1000.0 >= warmup_ms && count >= 2 {
            break elapsed;
        }
    };
    let per_op = elapsed / count as f64;
    let inner = ((sample_ms / 1000.0 / per_op).round() as usize).max(1);
    let samples = ((budget_ms / 1000.0 / (per_op * inner as f64)) as usize).min(samples).max(3);
    let mut times = Vec::with_capacity(samples);
    for _ in 0..samples {
        let begin = Instant::now();
        for _ in 0..inner {
            black_box(op(black_box(text)));
        }
        times.push(begin.elapsed().as_secs_f64() / inner as f64);
    }
    (times, inner, check)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args[1] == "mem" {
        let tasks = library(&args[2]);
        println!("{}", tasks[args[3].as_str()](&read(&args[4])));
        return;
    }
    let plan = std::fs::read_to_string(&args[2]).expect("a plan");
    let mut lines = plan.lines().filter(|line| !line.is_empty());
    let head: Vec<f64> = lines.next().expect("a header").split(' ').map(|x| x.parse().expect("a number")).collect();
    let mut made: HashMap<String, HashMap<&'static str, Op>> = HashMap::new();
    for line in lines {
        let job: Vec<&str> = line.split('\t').collect();
        let tasks = made.entry(job[0].to_string()).or_insert_with(|| library(job[0]));
        let (times, inner, check) = measure(&tasks[job[1]], &read(job[2]), head[0], head[1], head[2] as usize, head[3]);
        let shown: Vec<String> = times.iter().map(|t| format!("{t:.9e}")).collect();
        println!("{}\t{}\t{}\t{}\t{}\t{}", job[0], job[1], job[2], inner, check, shown.join(" "));
    }
}
