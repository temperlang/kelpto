// Times kelpto-md against commonmark-java and flexmark; see ../README.md.
// Compiles the Java that `temper build -b java` generates at the repo's
// top along with the bench, as the tour does.
//
//     ./gradlew -q --no-daemon installDist
//     build/install/kelpto-bench/bin/kelpto-bench time PLAN

plugins {
    application
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.commonmark:commonmark:0.32.0")
    implementation("com.vladsch.flexmark:flexmark:0.64.8")
}

// Exact versions, transitive ones too, in gradle.lockfile; refresh with
// `./gradlew dependencies --write-locks`.
dependencyLocking {
    lockAllConfigurations()
}

val temperOut = file("../../temper.out/java")

sourceSets {
    main {
        java {
            for (library in listOf("temper-core", "std", "kelpto-core", "kelpto-md")) {
                srcDir(temperOut.resolve("$library/src/main/java"))
            }
        }
    }
}

tasks.withType<JavaCompile> {
    options.encoding = "UTF-8"
    options.compilerArgs.add("-nowarn")
}

application {
    mainClass = "Bench"
}
