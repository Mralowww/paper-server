plugins {
    id("java")
}

group = "dev.sawsmp"
version = "1.0.0"

java {
    // CanvasMC / Paper 26.x 需要 Java 25
    toolchain.languageVersion.set(JavaLanguageVersion.of(25))
}

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
    maven("https://maven.canvasmc.io/releases")
}

dependencies {
    // 伺服器為 CanvasMC 26.2（Folia 分支）；Gson、Adventure 皆由伺服器內建提供，不需要另外打包
    compileOnly("io.canvasmc.canvas:canvas-api:26.2.build.941-stable")
}

tasks {
    compileJava {
        options.encoding = "UTF-8"
        options.release.set(25)
    }
    processResources {
        filteringCharset = "UTF-8"
        filesMatching("plugin.yml") { expand("version" to project.version) }
    }
}
