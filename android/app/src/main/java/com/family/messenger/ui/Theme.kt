package com.family.messenger.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val Coral = Color(0xFFFF7A59)

private val LightColors = lightColorScheme(
    primary = Coral,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFFFDBD1),
    onPrimaryContainer = Color(0xFF3B0A00),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFFFB59F),
    onPrimary = Color(0xFF5F1500),
    primaryContainer = Color(0xFF85280B),
    onPrimaryContainer = Color(0xFFFFDBD1),
)

@Composable
fun FamilyTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors, content = content)
}

private val timeFormat = DateTimeFormatter.ofPattern("a h:mm", Locale.KOREAN)
private val dateFormat = DateTimeFormatter.ofPattern("M월 d일", Locale.KOREAN)

/** "오후 3:05" for today, "10월 14일" for earlier days. */
fun formatTime(millis: Long, alwaysTime: Boolean = false): String {
    val time = Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault())
    return if (alwaysTime || time.toLocalDate() == LocalDate.now()) time.format(timeFormat) else time.format(dateFormat)
}
