package com.family.messenger.ui

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.family.messenger.FamilyApp
import com.family.messenger.data.ApiException
import com.family.messenger.data.Comment
import com.family.messenger.data.ImageCompressor
import com.family.messenger.data.MessageBus
import com.family.messenger.data.Post
import com.family.messenger.data.VideoCompressor
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch

class FeedViewModel(application: Application) : AndroidViewModel(application) {

    data class State(
        val posts: List<Post> = emptyList(),
        val loading: Boolean = true,
        val hasOlder: Boolean = false,
        val posting: Boolean = false,
        /** What the upload is doing right now, e.g. "동영상 압축 중 2/5 · 40%". */
        val progress: String? = null,
        val error: String? = null,
        /** Post whose comments sheet is open, and its comments. */
        val commentsFor: Long? = null,
        val comments: List<Comment> = emptyList(),
    )

    private val app = application as FamilyApp
    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        refresh()
        viewModelScope.launch { MessageBus.feedChanges.collect(::reloadPost) }
        viewModelScope.launch { MessageBus.connected.drop(1).filter { it }.collect { refresh() } }
    }

    fun refresh() = viewModelScope.launch {
        try {
            val posts = app.api.posts()
            _state.value = _state.value.copy(posts = posts, loading = false, hasOlder = posts.size >= PAGE, error = null)
        } catch (e: Exception) {
            _state.value = _state.value.copy(loading = false, error = e.message)
        }
    }

    fun loadOlder() = viewModelScope.launch {
        val oldest = _state.value.posts.lastOrNull()?.id ?: return@launch
        try {
            val older = app.api.posts(before = oldest)
            _state.value = _state.value.copy(posts = _state.value.posts + older, hasOlder = older.size >= PAGE)
        } catch (e: Exception) {
            _state.value = _state.value.copy(error = e.message)
        }
    }

    /**
     * Shrinks each photo/video, uploads them one at a time (to keep memory low), then creates the
     * post. Calls [onDone] once it is published so the composer can close.
     */
    fun create(text: String, items: List<Uri>, onDone: () -> Unit) = viewModelScope.launch {
        _state.value = _state.value.copy(posting = true, error = null)
        fun status(text: String) {
            _state.value = _state.value.copy(progress = text)
        }
        try {
            val uploaded = items.mapIndexed { index, uri ->
                val step = "${index + 1}/${items.size}"
                if (app.contentResolver.getType(uri)?.startsWith("video/") == true) {
                    status("동영상 줄이는 중 $step")
                    val video = VideoCompressor.compress(app, uri) { percent -> status("동영상 줄이는 중 $step · $percent%") }
                    try {
                        if (video.video.length() > MAX_VIDEO_BYTES) throw ApiException("동영상이 너무 깁니다. 더 짧게 잘라서 올려주세요.")
                        status("업로드 중 $step")
                        val poster = app.api.uploadPhoto(video.poster)
                        app.api.uploadVideo(video.video).name to poster.name
                    } finally {
                        video.video.delete()
                    }
                } else {
                    status("사진 줄이는 중 $step")
                    val jpeg = ImageCompressor.compress(app, uri)
                    status("업로드 중 $step")
                    app.api.uploadPhoto(jpeg).name to null
                }
            }
            status("올리는 중")
            upsert(app.api.createPost(text, uploaded))
            onDone()
        } catch (e: Exception) {
            _state.value = _state.value.copy(error = e.message ?: "올리지 못했습니다.")
        } finally {
            _state.value = _state.value.copy(posting = false, progress = null)
        }
    }

    fun delete(post: Post) = action {
        app.api.deletePost(post.id)
        remove(post.id)
    }

    fun react(post: Post, kind: String) = action { upsert(app.api.react(post.id, kind)) }

    fun openComments(post: Post) {
        _state.value = _state.value.copy(commentsFor = post.id, comments = emptyList())
        loadComments(post.id)
    }

    fun closeComments() {
        _state.value = _state.value.copy(commentsFor = null, comments = emptyList())
    }

    fun addComment(text: String) {
        val postId = _state.value.commentsFor ?: return
        action {
            app.api.addComment(postId, text)
            loadComments(postId)
        }
    }

    fun deleteComment(comment: Comment) = action {
        app.api.deleteComment(comment.id)
        loadComments(comment.postId)
    }

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }

    private fun loadComments(postId: Long) = action {
        val comments = app.api.comments(postId)
        if (_state.value.commentsFor == postId) _state.value = _state.value.copy(comments = comments)
    }

    /** Someone added, changed or deleted a post: fetch it again (with my own reaction state). */
    private fun reloadPost(id: Long) = viewModelScope.launch {
        try {
            upsert(app.api.post(id))
            if (_state.value.commentsFor == id) loadComments(id)
        } catch (e: ApiException) {
            if (e.code == 404) {
                remove(id)
                if (_state.value.commentsFor == id) closeComments()
            }
        }
    }

    private fun upsert(post: Post) {
        val posts = _state.value.posts
        val updated = if (posts.any { it.id == post.id }) {
            posts.map { if (it.id == post.id) post else it }
        } else {
            (posts + post).sortedByDescending { it.id }
        }
        _state.value = _state.value.copy(posts = updated)
    }

    private fun remove(id: Long) {
        _state.value = _state.value.copy(posts = _state.value.posts.filterNot { it.id == id })
    }

    private fun action(block: suspend () -> Unit) = viewModelScope.launch {
        try {
            block()
        } catch (e: Exception) {
            _state.value = _state.value.copy(error = e.message)
        }
    }

    private companion object {
        const val PAGE = 20
        const val MAX_VIDEO_BYTES = 100L * 1024 * 1024
    }
}
