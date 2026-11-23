// Platform-independent plugin code: backend client, request signing, event queue, config and messages.
// Third-party libraries are provided by Velocity and Paper at runtime (compileOnly).
plugins {
    `java-library`
}

group = "dev.mnm"
version = property("pluginVersion") as String

java {
    toolchain.languageVersion = JavaLanguageVersion.of(25)
}

val provided = listOf(
    "com.google.code.gson:gson:${property("gsonVersion")}",
    "org.yaml:snakeyaml:2.2",
    "org.slf4j:slf4j-api:2.0.17",
    "net.kyori:adventure-api:5.2.0",
    "net.kyori:adventure-text-minimessage:5.2.0",
)

dependencies {
    provided.forEach {
        compileOnly(it)
        testImplementation(it)
    }
    testImplementation("net.kyori:adventure-text-serializer-plain:5.2.0")
    testImplementation(platform("org.junit:junit-bom:${property("junitVersion")}"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    testRuntimeOnly("org.slf4j:slf4j-simple:2.0.17")
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.compilerArgs.addAll(listOf("-Xlint:all", "-Werror", "-Xlint:-processing"))
}

tasks.processTestResources {
    // Tests load the real catalogues maintained in packages/translations.
    from(rootProject.file("packages/translations/minecraft")) { into("messages") }
}

tasks.test {
    useJUnitPlatform()
}
