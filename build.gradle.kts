import org.apache.tools.ant.taskdefs.condition.Os

plugins {
    id("java")
    id("org.jetbrains.intellij.platform") version "2.19.0"
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

// Java 21 bytecode so the plugin also loads in 2025.x IDEs
tasks.withType<JavaCompile>().configureEach {
    options.release = 21
    options.encoding = "UTF-8"
    options.compilerArgs.add("-Xlint:deprecation")
}

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        // Build against a locally installed IDE when `localIdePath` is set (no download), otherwise fetch it.
        val localIdePath = providers.gradleProperty("localIdePath")
        if (localIdePath.isPresent && file(localIdePath.get()).exists()) {
            local(localIdePath)
        } else {
            intellijIdea(providers.gradleProperty("platformVersion"))
        }
        bundledPlugin("Git4Idea")
        bundledPlugin("com.intellij.modules.jcef")
        bundledModule("intellij.platform.vcs.dvcs")
        bundledModule("intellij.platform.vcs.dvcs.impl")
        bundledModule("intellij.platform.ui.jcef")
        bundledModule("intellij.libraries.jcef")
    }

    testImplementation(platform("org.junit:junit-bom:6.0.0"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

intellijPlatform {
    buildSearchableOptions = false

    pluginConfiguration {
        version = providers.gradleProperty("pluginVersion")
        ideaVersion {
            sinceBuild = providers.gradleProperty("pluginSinceBuild")
            untilBuild = provider { null }
        }
    }
}

// ---- bpmn.io web view (webview/) --------------------------------------------------------

val webviewDir = layout.projectDirectory.dir("webview")
val webviewOut = layout.buildDirectory.dir("generated/webview")

fun npm(vararg args: String): List<String> =
    if (Os.isFamily(Os.FAMILY_WINDOWS)) listOf("cmd", "/c", "npm", *args) else listOf("npm", *args)

val npmInstall = tasks.register<Exec>("npmInstall") {
    group = "webview"
    description = "Installs npm dependencies of the web view."
    workingDir = webviewDir.asFile
    commandLine(npm("install", "--no-audit", "--no-fund"))
    inputs.files(webviewDir.file("package.json"), webviewDir.file("package-lock.json"))
    outputs.dir(webviewDir.dir("node_modules"))
}

val buildWebview = tasks.register<Exec>("buildWebview") {
    group = "webview"
    description = "Bundles bpmn-js and the diff view into plugin resources."
    dependsOn(npmInstall)
    workingDir = webviewDir.asFile
    commandLine(npm("run", "build"))
    inputs.dir(webviewDir.dir("src"))
    inputs.file(webviewDir.file("build.mjs"))
    inputs.file(webviewDir.file("package-lock.json"))
    outputs.dir(webviewOut)
}

sourceSets {
    main {
        resources.srcDir(files(webviewOut).builtBy(buildWebview))
    }
}

// plugin license and third-party notices at the top level of the plugin distribution
tasks.prepareSandbox {
    from(layout.projectDirectory.file("LICENSE")) {
        into(intellijPlatform.projectName)
    }
    from(webviewOut.map { it.file("bpmn-compare/THIRD-PARTY-NOTICES.txt") }) {
        into(intellijPlatform.projectName)
    }
    dependsOn(buildWebview)
}

tasks.jar {
    from(layout.projectDirectory.file("LICENSE")) { into("META-INF") }
}

tasks.test {
    useJUnitPlatform()
}
