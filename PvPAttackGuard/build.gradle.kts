plugins {
    id("java")
    id("com.gradleup.shadow") version "9.6.1"
}

group = "dev.pvpattackguard"
version = "1.0.0"

java {
    toolchain.languageVersion.set(JavaLanguageVersion.of(25))
}

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:26.2.build.123-stable")
    implementation("org.xerial:sqlite-jdbc:3.46.1.3")
}

tasks {
    compileJava {
        options.encoding = "UTF-8"
        options.release.set(25)
    }
    processResources {
        filteringCharset = "UTF-8"
        expand("version" to version)
    }
    shadowJar {
        archiveClassifier.set("")
        relocate("org.sqlite", "dev.pvpattackguard.pvpattackguard.libs.sqlite")
    }
    build {
        dependsOn(shadowJar)
    }
}
