package com.family.messenger.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// Instagram-like palette: plain white/black surfaces, gray fills, one blue accent.
private val InstaBlue = Color(0xFF0095F6)
val HeartRed = Color(0xFFFF3040)

/** A family member's chat bubble color ("#RRGGBB" from the server); blue if unknown. */
fun bubbleColor(hex: String?): Color =
    runCatching { Color(android.graphics.Color.parseColor(hex ?: "#1877F2")) }.getOrDefault(Color(0xFF1877F2))

/** The orange-pink-purple ring Instagram draws around stories. */
val StoryGradient = Brush.linearGradient(
    listOf(Color(0xFFFEDA75), Color(0xFFFA7E1E), Color(0xFFD62976), Color(0xFF962FBF), Color(0xFF4F5BD5)),
)

private val LightColors = lightColorScheme(
    primary = InstaBlue,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFEFEFEF),
    onPrimaryContainer = Color(0xFF262626),
    secondaryContainer = Color(0xFFEFEFEF),
    background = Color.White,
    onBackground = Color.Black,
    surface = Color.White,
    onSurface = Color.Black,
    surfaceVariant = Color(0xFFEFEFEF),
    onSurfaceVariant = Color(0xFF737373),
    surfaceContainer = Color.White,
    surfaceContainerLow = Color(0xFFFAFAFA),
    surfaceContainerHigh = Color(0xFFF2F2F2),
    surfaceContainerHighest = Color(0xFFEFEFEF),
    outline = Color(0xFFDBDBDB),
    outlineVariant = Color(0xFFDBDBDB),
)

private val DarkColors = darkColorScheme(
    primary = InstaBlue,
    onPrimary = Color.White,
    primaryContainer = Color(0xFF262626),
    onPrimaryContainer = Color(0xFFF5F5F5),
    secondaryContainer = Color(0xFF262626),
    background = Color.Black,
    onBackground = Color(0xFFF5F5F5),
    surface = Color.Black,
    onSurface = Color(0xFFF5F5F5),
    surfaceVariant = Color(0xFF262626),
    onSurfaceVariant = Color(0xFFA8A8A8),
    surfaceContainer = Color.Black,
    surfaceContainerLow = Color(0xFF121212),
    surfaceContainerHigh = Color(0xFF1C1C1C),
    surfaceContainerHighest = Color(0xFF262626),
    outline = Color(0xFF363636),
    outlineVariant = Color(0xFF262626),
)

private val Base = Typography()
private val AppTypography = Base.copy(
    titleLarge = Base.titleLarge.copy(fontWeight = FontWeight.Bold),
    titleMedium = Base.titleMedium.copy(fontWeight = FontWeight.SemiBold),
)

@Composable
fun FamilyTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        typography = AppTypography,
        content = content,
    )
}

private val timeFormat = DateTimeFormatter.ofPattern("a h:mm", Locale.KOREAN)
private val dateFormat = DateTimeFormatter.ofPattern("M월 d일", Locale.KOREAN)
private val yearFormat = DateTimeFormatter.ofPattern("yyyy년 M월 d일", Locale.KOREAN)

/** "오후 3:05" for today, "10월 14일" for earlier days. */
fun formatTime(millis: Long, alwaysTime: Boolean = false): String {
    val time = Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault())
    return if (alwaysTime || time.toLocalDate() == LocalDate.now()) time.format(timeFormat) else time.format(dateFormat)
}

/** Instagram-style "방금 전", "5분 전", "3시간 전", "2일 전", then the date. */
fun formatAgo(millis: Long): String {
    val ago = Duration.between(Instant.ofEpochMilli(millis), Instant.now())
    val time = Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault())
    return when {
        ago.toMinutes() < 1 -> "방금 전"
        ago.toHours() < 1 -> "${ago.toMinutes()}분 전"
        ago.toDays() < 1 -> "${ago.toHours()}시간 전"
        ago.toDays() < 7 -> "${ago.toDays()}일 전"
        time.year == LocalDate.now().year -> time.format(dateFormat)
        else -> time.format(yearFormat)
    }
}
