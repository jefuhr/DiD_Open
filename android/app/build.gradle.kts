plugins {
	id("com.android.application")
	id("org.jetbrains.kotlin.plugin.compose")
	id("org.jetbrains.kotlin.plugin.serialization")
}

android {
	namespace = "nyc.juliet.ferryboard"
	compileSdk = 37
	defaultConfig {
		applicationId = "nyc.juliet.ferryboard"
		minSdk = 31
		targetSdk = 37
		versionCode = 1
		versionName = "1.0.0"
		testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
		buildConfigField("String", "API_BASE_URL", "\"https://juliet.nyc\"")
	}
	buildFeatures {
		compose = true
		buildConfig = true
	}
	compileOptions {
		sourceCompatibility = JavaVersion.VERSION_17
		targetCompatibility = JavaVersion.VERSION_17
	}
	buildTypes {
		release {
			isMinifyEnabled = true
			proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
		}
	}
	sourceSets {
		getByName("main").assets.srcDir(layout.buildDirectory.dir("generated/harborAssets").get().asFile)
		getByName("debug").assets.srcDir("../../ios/FerryBoard/PreviewData")
	}
	packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

val harborAssets = tasks.register<Sync>("harborAssets") {
	from(rootProject.projectDir.parentFile.resolve("content")) {
		include("harbor-chart.json", "harbor-shoreline.json", "manhattan-details.json")
	}
	into(layout.buildDirectory.dir("generated/harborAssets"))
}
tasks.named("preBuild").configure { dependsOn(harborAssets) }

dependencies {
	implementation(project(":core"))
	implementation(platform("androidx.compose:compose-bom:2026.09.00"))
	implementation("androidx.activity:activity-compose:1.11.0")
	implementation("androidx.core:core-ktx:1.17.0")
	implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
	implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
	implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.9.4")
	implementation("androidx.compose.ui:ui")
	implementation("androidx.compose.ui:ui-tooling-preview")
	implementation("androidx.compose.foundation:foundation")
	implementation("androidx.compose.material3:material3")
	implementation("androidx.compose.material:material-icons-extended:1.7.8")
	implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
	implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
	testImplementation("junit:junit:4.13.2")
	testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
	androidTestImplementation(platform("androidx.compose:compose-bom:2026.09.00"))
	androidTestImplementation("androidx.compose.ui:ui-test-junit4")
	androidTestImplementation("androidx.test.ext:junit:1.3.0")
	androidTestImplementation("androidx.test:runner:1.7.0")
	androidTestImplementation("androidx.test:core:1.7.0")
	debugImplementation("androidx.compose.ui:ui-tooling")
	debugImplementation("androidx.compose.ui:ui-test-manifest")
}
