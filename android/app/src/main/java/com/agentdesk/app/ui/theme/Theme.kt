package com.agentdesk.app.ui.theme

import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val BgDark = Color(0xFF090C10)
val SurfaceDark = Color(0xFF12161F)
val SurfaceElevatedDark = Color(0xFF1A202C)
val AccentBlue = Color(0xFF3B82F6)
val OkGreen = Color(0xFF22C55E)
val WarnAmber = Color(0xFFF59E0B)
val BadRed = Color(0xFFEF4444)

private val DarkColorScheme = darkColorScheme(
    primary = AccentBlue,
    secondary = Color(0xFF60A5FA),
    background = BgDark,
    surface = SurfaceDark,
    surfaceVariant = SurfaceElevatedDark,
    onPrimary = Color.White,
    onSecondary = Color.White,
    onBackground = Color(0xFFF0F6FC),
    onSurface = Color(0xFFF0F6FC),
)

@Composable
fun AgentDeskTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        content = content
    )
}
