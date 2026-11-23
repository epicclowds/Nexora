// Gradle build for the Minecraft plugins. The Node.js workspaces are managed by npm.
rootProject.name = "minecraft-network-manager"

dependencyResolutionManagement {
    repositories {
        mavenCentral()
        maven("https://repo.papermc.io/repository/maven-public/")
    }
}

include(":plugin-common", ":velocity-plugin", ":paper-plugin")
project(":plugin-common").projectDir = file("apps/plugin-common")
project(":velocity-plugin").projectDir = file("apps/velocity-plugin")
project(":paper-plugin").projectDir = file("apps/paper-plugin")
