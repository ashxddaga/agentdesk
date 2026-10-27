package com.agentdesk.app.ui.theme

import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val HerdrBg = Color(0xFF07090E)
val HerdrFrame = Color(0xFF0D121C)
val HerdrFrameHeader = Color(0xFF131924)
val HerdrBorder = Color(0xFF1E2638)
val HerdrGreen = Color(0xFF22C55E)
val HerdrCyan = Color(0xFF38BDF8)
val HerdrAmber = Color(0xFFF59E0B)
val HerdrRed = Color(0xFFEF4444)
val HerdrText = Color(0xFFE2E8F0)
val HerdrTextMuted = Color(0xFF64748B)
val HerdrAccent = Color(0xFF3B82F6)

private val DarkColorScheme = darkColorScheme(
    primary = HerdrCyan,
    secondary = HerdrAccent,
    background = HerdrBg,
    surface = HerdrFrame,
    surfaceVariant = HerdrFrameHeader,
    onPrimary = Color.Black,
    onSecondary = Color.White,
    onBackground = HerdrText,
    onSurface = HerdrText
)

@Composable
fun AgentDeskTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        content = content
    )
}
