plugins {
    java
}

group = "dev.mnm"
version = property("pluginVersion") as String

java {
    toolchain.languageVersion = JavaLanguageVersion.of(25)
}

dependencies {
    compileOnly("com.velocitypowered:velocity-api:${property("velocityApiVersion")}")
    annotationProcessor("com.velocitypowered:velocity-api:${property("velocityApiVersion")}")
    // Optional integration: only used when LuckPerms is installed on the proxy (never bundled).
    compileOnly("net.luckperms:api:5.4")
    implementation(project(":plugin-common"))
}

// Compile-time constant for the @Plugin annotation.
val generateBuildInfo = tasks.register("generateBuildInfo") {
    val pluginVersion = project.version.toString()
    val outputDir = layout.buildDirectory.dir("generated/sources/buildinfo/java")
    inputs.property("version", pluginVersion)
    outputs.dir(outputDir)
    doLast {
        val file = outputDir.get().file("dev/mnm/velocity/BuildInfo.java").asFile
        file.parentFile.mkdirs()
        file.writeText(
            """
            package dev.mnm.velocity;

            /** Generated at build time. */
            public final class BuildInfo {
                public static final String VERSION = "$pluginVersion";

                private BuildInfo() {}
            }
            """.trimIndent() + "\n",
        )
    }
}

sourceSets.main {
    java.srcDir(generateBuildInfo)
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.compilerArgs.addAll(listOf("-Xlint:all", "-Werror", "-Xlint:-processing"))
}

tasks.processResources {
    // Translations are maintained centrally in packages/translations.
    from(rootProject.file("packages/translations/minecraft")) { into("messages") }
}

tasks.jar {
    // Release artifact name: Nexora-Velocity-<version>.jar (plugin id and data folder stay "networkmanager"/"NetworkManager").
    archiveBaseName = "Nexora-Velocity"
    manifest {
        attributes(
            "Implementation-Title" to "Nexora Velocity plugin",
            "Implementation-Version" to project.version,
            "Implementation-Vendor" to "Nexora",
        )
    }
    // Reproducible archives: stable file order, no timestamps.
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
    // Bundle plugin-common (its own dependencies are provided by Velocity).
    dependsOn(configurations.runtimeClasspath)
    from({ configurations.runtimeClasspath.get().map { zipTree(it) } })
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
}
