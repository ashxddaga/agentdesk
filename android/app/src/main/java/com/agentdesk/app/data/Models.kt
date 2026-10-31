package com.agentdesk.app.data

data class PaneInfo(
    val paneId: String,
    val agent: String,
    val status: String,
    val title: String,
    val workspace: String,
    val pid: String?,
    val previewLine: String = ""
)

data class WorkspaceInfo(
    val name: String,
    val count: Int
)

data class AgentSession(
    val agent: String,
    val cid: String,
    val title: String,
    val dateStr: String,
    val snippet: String,
    val workdir: String,
    val turns: Int = 0
)

data class BoardTask(
    val id: String,
    val title: String,
    val agent: String,
    val status: String,
    val reviewBy: String,
    val reviewStatus: String
)

data class FeedbackItem(
    val agent: String,
    val timestamp: String,
    val text: String
)

data class WorkdirInfo(
    val name: String,
    val path: String
)

data class TelemetryInfo(
    val isRunning: Boolean = false,
    val durationStr: String = "0s",
    val turns: Int = 0,
    val estimatedTokens: Int = 0
)
