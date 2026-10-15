package com.family.messenger

import org.junit.Assume.assumeTrue
import java.io.File
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.URL
import java.nio.file.Files

/**
 * Runs the real family server (../../server) with Node for UI tests. Tests using it are skipped
 * when Node isn't installed.
 */
class TestServer : AutoCloseable {
    val url: String
    private val process: Process
    private val dataDir: File = Files.createTempDirectory("fm-ui-").toFile()

    init {
        val serverDir = File("../../server").canonicalFile
        val nodeOk = runCatching { ProcessBuilder("node", "--version").start().waitFor() == 0 }.getOrDefault(false)
        assumeTrue("node is needed for UI tests", nodeOk && File(serverDir, "node_modules").isDirectory)
        val port = ServerSocket(0).use { it.localPort }
        url = "http://127.0.0.1:$port"
        process = ProcessBuilder("node", "--disable-warning=ExperimentalWarning", "src/index.js")
            .directory(serverDir)
            .redirectErrorStream(true)
            .redirectOutput(File(dataDir, "server.log"))
            .apply {
                environment()["FAMILY_CODE"] = "test"
                environment()["DATA_DIR"] = dataDir.absolutePath
                environment()["PORT"] = port.toString()
            }
            .start()
        val deadline = System.currentTimeMillis() + 15_000
        while (true) {
            val up = runCatching {
                (URL("$url/api/health").openConnection() as HttpURLConnection).run {
                    connectTimeout = 500
                    responseCode == 200
                }
            }.getOrDefault(false)
            if (up) break
            check(System.currentTimeMillis() < deadline) { "server did not start: " + File(dataDir, "server.log").readText() }
            Thread.sleep(100)
        }
    }

    override fun close() {
        process.destroy()
        process.waitFor()
        dataDir.deleteRecursively()
    }
}
