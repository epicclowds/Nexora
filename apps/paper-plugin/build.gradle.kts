plugins {
    java
}

group = "dev.mnm"
version = property("pluginVersion") as String

java {
    toolchain.languageVersion = JavaLanguageVersion.of(25)
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:${property("paperApiVersion")}")
    implementation(project(":plugin-common"))
    testImplementation("io.papermc.paper:paper-api:${property("paperApiVersion")}")
    testImplementation(platform("org.junit:junit-bom:${property("junitVersion")}"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    // Paper API marks a number of members as deprecated/experimental; keep warnings visible but non-fatal.
    options.compilerArgs.addAll(listOf("-Xlint:all", "-Xlint:-processing"))
}

tasks.processResources {
    val pluginVersion = project.version.toString()
    inputs.property("version", pluginVersion)
    filesMatching("plugin.yml") { expand("version" to pluginVersion) }
    from(rootProject.file("packages/translations/minecraft")) { into("messages") }
}

tasks.jar {
    // Release artifact name: Nexora-Paper-<version>.jar (plugin id and data folder stay "networkmanager"/"NetworkManager").
    archiveBaseName = "Nexora-Paper"
    manifest {
        attributes(
            "Implementation-Title" to "Nexora Paper plugin",
            "Implementation-Version" to project.version,
            "Implementation-Vendor" to "Nexora",
        )
    }
    // Reproducible archives: stable file order, no timestamps.
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
    dependsOn(configurations.runtimeClasspath)
    from({ configurations.runtimeClasspath.get().map { zipTree(it) } })
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
}
