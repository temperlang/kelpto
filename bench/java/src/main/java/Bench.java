// Times Markdown parsers in Java, for scripts/bench.py.
//
//     build/install/kelpto-bench/bin/kelpto-bench time PLAN
//     build/install/kelpto-bench/bin/kelpto-bench mem LIBRARY TASK FILE
//
// See ../README.md for the plan format and what each task does.

import com.vladsch.flexmark.parser.ParserEmulationProfile;
import com.vladsch.flexmark.util.data.MutableDataSet;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.ToLongFunction;
import kelpto_md.Heading;
import kelpto_md.MarkdownDocument;
import kelpto_md.MarkdownEditor;
import kelpto_md.MarkdownNode;
import kelpto_md.MarkdownParser;
import kelpto_md.MarkdownRenderer;

public class Bench {
    static Map<String, ToLongFunction<String>> kelpto() {
        MarkdownParser parser = MarkdownParser.commonMark;
        MarkdownRenderer renderer = new MarkdownRenderer().withRawHtmlTrusted();
        return Map.of(
            "parse", text -> parser.parse(text).getSpan().getEnd(),
            "render", text -> renderer.render(parser.parse(text)).length(),
            "walk", text -> {
                MarkdownDocument doc = parser.parse(text);
                List<MarkdownNode> views = doc.getDescendants();
                long headings = 0;
                for (MarkdownNode view : views) {
                    if (view instanceof Heading) headings += 1;
                }
                return views.size() + headings + doc.getAsWritten().length();
            },
            "transform", text -> {
                MarkdownDocument doc = parser.parse(text);
                MarkdownEditor editor = doc.editor();
                for (Heading heading : doc.getHeadings()) {
                    int level = heading.getLevel();
                    if (level < 6 && !(level == 2 && heading.getStyle().equals("setext"))) {
                        editor.setLevel(heading, level + 1);
                    }
                }
                return editor.toDocument().getAsWritten().length();
            });
    }

    static Map<String, ToLongFunction<String>> commonmarkJava() {
        var parser = org.commonmark.parser.Parser.builder().build();
        var renderer = org.commonmark.renderer.html.HtmlRenderer.builder().build();
        return Map.of(
            "parse", text -> parser.parse(text).getFirstChild() != null ? 1 : 0,
            "render", text -> renderer.render(parser.parse(text)).length());
    }

    static Map<String, ToLongFunction<String>> flexmark() {
        // flexmark's own defaults differ from CommonMark; this profile follows it.
        var options = new MutableDataSet();
        options.setFrom(ParserEmulationProfile.COMMONMARK);
        var parser = com.vladsch.flexmark.parser.Parser.builder(options).build();
        var renderer = com.vladsch.flexmark.html.HtmlRenderer.builder(options).build();
        return Map.of(
            "parse", text -> parser.parse(text).getFirstChild() != null ? 1 : 0,
            "render", text -> renderer.render(parser.parse(text)).length());
    }

    static Map<String, ToLongFunction<String>> library(String name) {
        return switch (name) {
            case "kelpto" -> kelpto();
            case "commonmark-java" -> commonmarkJava();
            case "flexmark" -> flexmark();
            case "none" -> Map.of("read", text -> text.length());
            default -> throw new IllegalArgumentException(name);
        };
    }

    static String read(String path) throws IOException {
        return Files.readString(Path.of(path), StandardCharsets.UTF_8);
    }

    static long check;

    static List<Double> measure(ToLongFunction<String> op, String text, double warmupMs, double sampleMs, int samples, double budgetMs, int[] innerOut) {
        int count = 0;
        double elapsed;
        long start = System.nanoTime();
        for (;;) {
            check = op.applyAsLong(text);
            count += 1;
            elapsed = (System.nanoTime() - start) / 1e9;
            if (elapsed * 1000 >= warmupMs && count >= 2) break;
        }
        double perOp = elapsed / count;
        int inner = (int) Math.max(1, Math.round(sampleMs / 1000 / perOp));
        samples = Math.max(3, Math.min(samples, (int) (budgetMs / 1000 / (perOp * inner))));
        List<Double> times = new ArrayList<>();
        long sink = 0;
        for (int i = 0; i < samples; i += 1) {
            System.gc();
            long begin = System.nanoTime();
            for (int j = 0; j < inner; j += 1) sink += op.applyAsLong(text);
            times.add((System.nanoTime() - begin) / 1e9 / inner);
        }
        if (sink == 42) System.err.print("");
        innerOut[0] = inner;
        return times;
    }

    public static void main(String[] args) throws IOException {
        if (args[0].equals("mem")) {
            System.out.println(library(args[1]).get(args[2]).applyAsLong(read(args[3])));
            return;
        }
        List<String> lines = Files.readAllLines(Path.of(args[1]), StandardCharsets.UTF_8);
        String[] head = lines.get(0).split(" ");
        Map<String, Map<String, ToLongFunction<String>>> made = new HashMap<>();
        StringBuilder out = new StringBuilder();
        for (String line : lines.subList(1, lines.size())) {
            if (line.isEmpty()) continue;
            String[] job = line.split("\t");
            var tasks = made.computeIfAbsent(job[0], Bench::library);
            int[] inner = new int[1];
            List<Double> times = measure(tasks.get(job[1]), read(job[2]),
                Double.parseDouble(head[0]), Double.parseDouble(head[1]), Integer.parseInt(head[2]), Double.parseDouble(head[3]), inner);
            StringBuilder shown = new StringBuilder();
            for (double t : times) {
                if (shown.length() > 0) shown.append(' ');
                shown.append(String.format("%.9e", t));
            }
            System.out.println(job[0] + "\t" + job[1] + "\t" + job[2] + "\t" + inner[0] + "\t" + check + "\t" + shown);
        }
    }
}
