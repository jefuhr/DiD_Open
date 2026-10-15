plugins {
	id("org.jetbrains.kotlin.jvm")
	id("org.jetbrains.kotlin.plugin.serialization")
}

kotlin { jvmToolchain(17) }

dependencies {
	implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
	implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
	testImplementation("junit:junit:4.13.2")
	testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
}

tasks.test {
	systemProperty("ferry.repo.root", rootProject.projectDir.parentFile.absolutePath)
	val liveSmoke = providers.environmentVariable("FERRY_LIVE_SMOKE").orElse("0")
	inputs.property("ferryLiveSmoke", liveSmoke)
	environment("FERRY_LIVE_SMOKE", liveSmoke.get())
	providers.environmentVariable("FERRY_SERVICE_CONTRACT").orNull?.let { directory ->
		inputs.dir(directory).withPathSensitivity(PathSensitivity.RELATIVE)
		environment("FERRY_SERVICE_CONTRACT", directory)
	}
	testLogging { events("failed", "skipped") }
}
