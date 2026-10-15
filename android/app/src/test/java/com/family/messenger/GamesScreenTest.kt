package com.family.messenger

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.espresso.Espresso
import com.family.messenger.data.Api
import com.family.messenger.data.GameInfo
import com.family.messenger.ui.FamilyTheme
import com.family.messenger.ui.GamePlayer
import com.family.messenger.ui.GamesScreen
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The games tab shows what's in the server's games.json, and opens/closes a game. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = FamilyApp::class)
class GamesScreenTest {
    @get:Rule
    val compose = createAndroidComposeRule<androidx.activity.ComponentActivity>()

    private lateinit var server: TestServer
    private lateinit var app: FamilyApp

    @Before
    fun setUp() {
        server = TestServer()
        app = ApplicationProvider.getApplicationContext()
        runBlocking {
            val auth = app.api.register(server.url, "test", "kid", "아이", "pass1234")
            app.session.save(Api.normalize(server.url), auth)
        }
    }

    @After
    fun tearDown() {
        server.close()
    }

    @Test
    fun listsServerGamesAndOpensOne() {
        compose.setContent {
            var playing by androidx.compose.runtime.remember { mutableStateOf<GameInfo?>(null) }
            FamilyTheme {
                val game = playing
                if (game == null) GamesScreen(app, onPlay = { playing = it }) else GamePlayer(app, game, onBack = { playing = null })
            }
        }
        compose.waitUntil(10_000) { compose.onAllNodesWithText("짝 맞추기").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("두더지 잡기").assertExists()
        compose.onNodeWithText("짝 맞추기").performClick()
        compose.onNodeWithText("🃏 짝 맞추기").assertExists()
        compose.onNodeWithContentDescription("다시 시작").assertExists()
        Espresso.pressBack()
        compose.waitForIdle()
        compose.onNodeWithText("가족 게임").assertExists()
    }
}
