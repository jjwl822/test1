package com.family.messenger

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.espresso.Espresso
import com.family.messenger.data.Api
import com.family.messenger.ui.CalendarScreen
import com.family.messenger.ui.FamilyTheme
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Drives the real calendar screen against the real server. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = FamilyApp::class)
class CalendarScreenTest {
    @get:Rule
    val compose = createAndroidComposeRule<androidx.activity.ComponentActivity>()

    private lateinit var server: TestServer
    private lateinit var app: FamilyApp

    @Before
    fun setUp() {
        server = TestServer()
        app = ApplicationProvider.getApplicationContext()
        runBlocking {
            val auth = app.api.register(server.url, "test", "mom", "엄마", "pass1234")
            app.session.save(Api.normalize(server.url), auth)
        }
        compose.setContent { FamilyTheme { CalendarScreen(app) } }
    }

    @After
    fun tearDown() {
        server.close()
    }

    private fun waitForText(text: String) =
        compose.waitUntil(10_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }

    @Test
    fun addEventSavesAndCloses() {
        compose.onNodeWithContentDescription("일정 추가").performClick()
        compose.onNodeWithText("일정 추가").assertExists()
        compose.onNodeWithText("제목 (예: 엄마 생일, 치과)").performTextInput("치과 예약")
        compose.onNodeWithText("저장").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("일정 추가").fetchSemanticsNodes().isEmpty() }
        waitForText("치과 예약")
        val saved = runBlocking { app.api.events() }
        check(saved.single().title == "치과 예약") { "server has $saved" }
    }

    @Test
    fun addEventWithDateTimeYearlyAndNote() {
        compose.onNodeWithContentDescription("일정 추가").performClick()
        compose.onNodeWithText("제목 (예: 엄마 생일, 치과)").performTextInput("아빠 생일")
        compose.onNode(hasText("날짜:", substring = true)).performClick()
        compose.onAllNodesWithText("확인").onFirst().performClick()
        compose.onNode(hasText("시간:", substring = true)).performClick()
        compose.onAllNodesWithText("확인").onFirst().performClick()
        compose.onNode(isToggleable()).performClick()
        compose.onNodeWithText("메모 (선택)").performTextInput("케이크 주문")
        compose.onNodeWithText("저장").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("일정 추가").fetchSemanticsNodes().isEmpty() }
        val saved = runBlocking { app.api.events() }.single()
        check(saved.title == "아빠 생일" && saved.yearly && saved.time == "09:00" && saved.note == "케이크 주문") { "server has $saved" }
    }

    @Test
    fun backClosesTheEditor() {
        compose.onNodeWithContentDescription("일정 추가").performClick()
        compose.onNodeWithText("일정 추가").assertExists()
        Espresso.pressBack()
        compose.waitForIdle()
        compose.onAllNodesWithText("일정 추가").assertCountEquals(0)
    }
}
