package com.family.messenger.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.putJsonArray
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiException(message: String, val code: Int = 0) : Exception(message)

class Api(private val session: Session) {

    /** Shared client. Adds the login token to every request sent to our own server. */
    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            val request = chain.request()
            val auth = session.auth.value
            val server = auth?.serverUrl?.toHttpUrlOrNull()
            val sameServer = server != null && request.url.host == server.host && request.url.port == server.port
            if (sameServer && request.header("Authorization") == null) {
                chain.proceed(request.newBuilder().header("Authorization", "Bearer ${auth!!.token}").build())
            } else {
                chain.proceed(request)
            }
        }
        .build()

    suspend fun register(
        serverUrl: String,
        familyCode: String,
        username: String,
        displayName: String,
        password: String,
    ): AuthResponse {
        val body = buildJsonObject {
            put("familyCode", familyCode)
            put("username", username)
            put("displayName", displayName)
            put("password", password)
        }
        return call(post(normalize(serverUrl) + "/api/register", body))
    }

    suspend fun login(serverUrl: String, username: String, password: String): AuthResponse {
        val body = buildJsonObject {
            put("username", username)
            put("password", password)
        }
        return call(post(normalize(serverUrl) + "/api/login", body))
    }

    suspend fun logout() {
        call<JsonObject>(post(url("/api/logout"), buildJsonObject { }))
    }

    suspend fun conversations(): List<Conversation> =
        call(Request.Builder().url(url("/api/conversations")).build())

    suspend fun messages(conversationId: String, before: Long? = null): List<Message> {
        val query = if (before != null) "?before=$before" else ""
        return call(Request.Builder().url(url("/api/conversations/$conversationId/messages$query")).build())
    }

    suspend fun sendText(conversationId: String, text: String): Message =
        call(post(url("/api/conversations/$conversationId/messages"), buildJsonObject { put("text", text) }))

    suspend fun sendImage(conversationId: String, jpeg: ByteArray): Message =
        call(
            Request.Builder()
                .url(url("/api/conversations/$conversationId/images"))
                .post(jpeg.toRequestBody("image/jpeg".toMediaType()))
                .build(),
        )

    suspend fun posts(before: Long? = null): List<Post> {
        val query = if (before != null) "?before=$before" else ""
        return call(Request.Builder().url(url("/api/posts$query")).build())
    }

    suspend fun post(id: Long): Post = call(Request.Builder().url(url("/api/posts/$id")).build())

    /** Uploads one story photo (JPEG bytes) or video (MP4 file); attach it with [createPost]. */
    suspend fun uploadPhoto(jpeg: ByteArray): Uploaded = upload(jpeg.toRequestBody("image/jpeg".toMediaType()))

    suspend fun uploadVideo(mp4: File): Uploaded = upload(mp4.asRequestBody("video/mp4".toMediaType()))

    private suspend fun upload(body: RequestBody): Uploaded =
        call(Request.Builder().url(url("/api/media")).post(body).build())

    suspend fun feedSummary(): FeedSummary = call(Request.Builder().url(url("/api/feed/summary")).build())

    /** [media] holds upload names, each with the poster frame's upload name for new videos. */
    suspend fun createPost(text: String, media: List<Pair<String, String?>>): Post =
        call(post(url("/api/posts"), postBody(text, media)))

    /** Replaces the post's text and media; [media] may mix names already in the post and new uploads. */
    suspend fun updatePost(id: Long, text: String, media: List<Pair<String, String?>>): Post =
        call(
            Request.Builder()
                .url(url("/api/posts/$id"))
                .patch(json.encodeToString(postBody(text, media)).toJsonBody())
                .build(),
        )

    private fun postBody(text: String, media: List<Pair<String, String?>>): JsonObject =
        buildJsonObject {
            put("text", text)
            putJsonArray("media") {
                for ((name, poster) in media) {
                    addJsonObject {
                        put("name", name)
                        if (poster != null) put("poster", poster)
                    }
                }
            }
        }

    suspend fun deletePost(id: Long) {
        call<JsonObject>(Request.Builder().url(url("/api/posts/$id")).delete().build())
    }

    suspend fun react(postId: Long, kind: String): Post =
        call(post(url("/api/posts/$postId/reactions"), buildJsonObject { put("kind", kind) }))

    suspend fun comments(postId: Long): List<Comment> =
        call(Request.Builder().url(url("/api/posts/$postId/comments")).build())

    suspend fun addComment(postId: Long, text: String): Comment =
        call(post(url("/api/posts/$postId/comments"), buildJsonObject { put("text", text) }))

    suspend fun deleteComment(id: Long) {
        call<JsonObject>(Request.Builder().url(url("/api/comments/$id")).delete().build())
    }

    /** Turns a server-relative path such as /api/images/x.jpg into a full URL. */
    fun url(path: String): String {
        val base = session.auth.value?.serverUrl ?: throw ApiException("로그인이 필요합니다.")
        return base + path
    }

    fun socketUrl(): String = url("/ws").replaceFirst(Regex("^http"), "ws")

    private fun post(url: String, body: JsonObject): Request =
        Request.Builder().url(url).post(json.encodeToString(body).toJsonBody()).build()

    private fun String.toJsonBody(): RequestBody = toRequestBody("application/json".toMediaType())

    private suspend inline fun <reified T> call(request: Request): T = withContext(Dispatchers.IO) {
        val response = try {
            client.newCall(request).execute()
        } catch (e: IOException) {
            throw ApiException("서버에 연결할 수 없습니다. 주소와 네트워크를 확인하세요.")
        }
        response.use {
            val text = it.body?.string().orEmpty()
            if (!it.isSuccessful) {
                if (it.code == 401 && session.auth.value != null && !request.url.encodedPath.endsWith("/login")) {
                    session.clear()
                }
                val error = runCatching { json.parseToJsonElement(text) as JsonObject }
                    .getOrNull()?.get("error")?.jsonPrimitive?.content
                throw ApiException(error ?: "요청에 실패했습니다. (${it.code})", it.code)
            }
            json.decodeFromString<T>(text)
        }
    }

    companion object {
        val json = Json {
            ignoreUnknownKeys = true
            explicitNulls = false
        }

        /** Accepts "192.168.0.10:3000" or "http://host:3000/" and returns "http://host:3000". */
        fun normalize(input: String): String {
            val trimmed = input.trim().trimEnd('/')
            val withScheme = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed else "http://$trimmed"
            if (withScheme.toHttpUrlOrNull() == null) throw ApiException("서버 주소가 올바르지 않습니다.")
            return withScheme
        }
    }
}
