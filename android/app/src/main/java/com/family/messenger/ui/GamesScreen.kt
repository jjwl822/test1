package com.family.messenger.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.family.messenger.FamilyApp
import com.family.messenger.data.GameInfo
import kotlinx.coroutines.launch
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Games tab. The list comes from games.json on the server and each game is an HTML page there,
 * so games can be added or changed on the server without updating the app.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GamesScreen(app: FamilyApp, onPlay: (GameInfo) -> Unit) {
    var games by remember { mutableStateOf<List<GameInfo>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    suspend fun load() {
        try {
            games = app.api.games()
            error = null
        } catch (e: Exception) {
            error = e.message
        }
    }
    LaunchedEffect(Unit) { load() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("가족 게임", style = MaterialTheme.typography.titleLarge) },
                actions = {
                    IconButton(onClick = { scope.launch { load() } }) { Icon(Icons.Filled.Refresh, contentDescription = "새로고침") }
                },
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    load()
                    refreshing = false
                }
            },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
                if (games == null && error == null) {
                    item { Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
                }
                if (games?.isEmpty() == true) {
                    item {
                        Text(
                            "아직 게임이 없어요. 서버의 web/games 폴더에 게임을 넣어 주세요.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(16.dp),
                        )
                    }
                }
                items(games.orEmpty(), key = { it.id }) { game ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.surfaceContainerLow, RoundedCornerShape(14.dp))
                            .clickable { onPlay(game) }
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier.size(52.dp).background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(14.dp)),
                            contentAlignment = Alignment.Center,
                        ) { Text(game.emoji, fontSize = 30.sp) }
                        Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                            Text(game.title, fontWeight = FontWeight.SemiBold)
                            if (game.description.isNotBlank()) {
                                Text(game.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null)
                    }
                }
            }
        }
    }
}

/** Plays a game full screen in a WebView, logged in as the current family member (for leaderboards). */
@SuppressLint("SetJavaScriptEnabled")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GamePlayer(app: FamilyApp, game: GameInfo, onBack: () -> Unit) {
    val url = app.api.url(game.url)
    var webView by remember { mutableStateOf<WebView?>(null) }

    // Back goes back inside the game first (if it has pages), then closes it.
    BackHandler {
        val view = webView
        if (view != null && view.canGoBack()) view.goBack() else onBack()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("${game.emoji} ${game.title}", style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "뒤로") }
                },
                actions = {
                    IconButton(onClick = { webView?.reload() }) { Icon(Icons.Filled.Refresh, contentDescription = "다시 시작") }
                },
            )
        },
    ) { padding ->
        AndroidView(
            modifier = Modifier.fillMaxSize().padding(padding),
            factory = { context ->
                // Games use the same login as the app (the server's login cookie).
                val auth = app.session.auth.value
                if (auth != null) {
                    val secure = if (auth.serverUrl.startsWith("https")) "; Secure" else ""
                    CookieManager.getInstance().apply {
                        setAcceptCookie(true)
                        setCookie(auth.serverUrl, "fm_token=${auth.token}; Path=/$secure")
                        flush()
                    }
                }
                WebView(context).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.mediaPlaybackRequiresUserGesture = false
                    webViewClient = object : WebViewClient() {
                        // Pages on the family server stay in the game; other links open the browser.
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            val server = auth?.serverUrl?.toHttpUrlOrNull()
                            if (server != null && request.url.host == server.host) return false
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(request.url.toString())))
                            return true
                        }
                    }
                    loadUrl(url)
                    webView = this
                }
            },
            onRelease = { it.destroy() },
        )
    }
}
