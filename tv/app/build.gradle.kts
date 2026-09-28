import java.util.Properties

plugins {
    id("com.android.application")
}

// Release version: GAIA_VERSION from CI (the vX.Y.Z tag), else a dev build.
val gaiaVersion = providers.environmentVariable("GAIA_VERSION")
    .map { it.trim().removePrefix("v") }
    .orElse("0.1.0-dev")

// The address the app opens, unless the TV was told another one
// (`am start -e url http://…/tv`, which Nexiom's TV setup does).
val defaultUrl = providers.gradleProperty("gaiaUrl").orElse("http://gaia.nexiom.home/tv")

// Release signing, as in Cinematica: environment in CI, signing.properties
// (gitignored) locally; debug-signed without either.
val signingProps: Properties? = rootProject.file("signing.properties").takeIf { it.exists() }
    ?.let { f -> Properties().also { p -> f.inputStream().use { p.load(it) } } }
fun signingValue(env: String, prop: String): String? =
    providers.environmentVariable(env).orNull ?: signingProps?.getProperty(prop)
val keystorePath = signingValue("GAIA_KEYSTORE_PATH", "storeFile")

android {
    namespace = "io.github.superthom196.gaia"
    compileSdk = 37

    defaultConfig {
        applicationId = "io.github.superthom196.gaia"
        minSdk = 28
        targetSdk = 36
        // x.y.z -> x*10000 + y*100 + z: always rises with the version, so
        // Android never refuses a newer release as a downgrade.
        versionCode = gaiaVersion.get().substringBefore("-").split(".")
            .mapNotNull { it.toIntOrNull() }.let { (it + listOf(0, 0, 0)).take(3) }
            .let { (x, y, z) -> maxOf(1, x * 10000 + y * 100 + z) }
        versionName = gaiaVersion.get()
        buildConfigField("String", "DEFAULT_URL", "\"${defaultUrl.get()}\"")
    }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = signingValue("GAIA_KEYSTORE_PASSWORD", "storePassword")
                keyAlias = signingValue("GAIA_KEY_ALIAS", "keyAlias")
                keyPassword = signingValue("GAIA_KEY_PASSWORD", "keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    lint {
        // lintVital crashes on this toolchain (missing IntelliJ classes), as in Cinematica.
        checkReleaseBuilds = false
        abortOnError = false
    }
}
