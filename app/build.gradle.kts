import java.util.Properties

// Дані підпису: спочатку змінні середовища, потім локальний keystore.properties (не потрапляє в git)
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun signingValue(env: String, prop: String): String? =
    System.getenv(env)?.takeIf { it.isNotBlank() } ?: keystoreProps.getProperty(prop)?.takeIf { it.isNotBlank() }

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}

android {
    namespace = "com.kishka.messenger"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.kishka.messenger"
        minSdk = 24
        targetSdk = 34
        versionCode = 4
        versionName = "3.1"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    // Підпис релізу. Ключ і паролі НЕ лежать у репозиторії: вони беруться зі змінних середовища (GitHub Secrets у workflow)
    // або з локального файла keystore.properties (він у .gitignore). Якщо їх немає — збирається непідписаний APK.
    signingConfigs {
        create("release") {
            val storePath = signingValue("KISHKA_KEYSTORE_FILE", "storeFile")
            val storePass = signingValue("KISHKA_KEYSTORE_PASSWORD", "storePassword")
            val alias = signingValue("KISHKA_KEY_ALIAS", "keyAlias")
            val keyPass = signingValue("KISHKA_KEY_PASSWORD", "keyPassword")
            if (storePath != null && storePass != null && alias != null && keyPass != null && file(storePath).exists()) {
                storeFile = file(storePath)
                storePassword = storePass
                keyAlias = alias
                keyPassword = keyPass
            }
        }
    }

    buildTypes {
        release {
            // Справжній релізний APK: не debuggable, без тестових позначок
            isDebuggable = false
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            val releaseSigning = signingConfigs.getByName("release")
            if (releaseSigning.storeFile != null) signingConfig = releaseSigning
        }
        debug {
            // Налагоджувальна збірка підписується стандартним debug-ключем Android Studio (без наших секретів)
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.1"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation(platform("androidx.compose:compose-bom:2023.08.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    // XML-бібліотека Google Material Components
    implementation("com.google.android.material:material:1.11.0")

    // Firebase (Auth, Firestore, Storage, Cloud Messaging для push-сповіщень)
    implementation(platform("com.google.firebase:firebase-bom:33.1.0"))
    implementation("com.google.firebase:firebase-auth-ktx")
    implementation("com.google.firebase:firebase-firestore-ktx")
    implementation("com.google.firebase:firebase-storage-ktx")
    implementation("com.google.firebase:firebase-messaging-ktx")

    // Socket.IO Client для зв'язку з Node.js
    implementation("io.socket:socket.io-client:2.1.0") {
        exclude(group = "org.json", module = "json")
    }

    // Coil для аватарок
    // Голосовий канал дзвінків: WebSocket на окремий сервіс Kishka-call (див. Voicechannel.kt і папку calls/)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.coil-kt:coil-compose:2.6.0")
}
