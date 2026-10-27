package com.agentdesk.app.data

data class PaneInfo(
    val paneId: String,
    val agent: String,
    val status: String,
    val title: String,
    val workspace: String,
    val pid: String?
)

data class AgentSession(
    val agent: String,
    val cid: String,
    val title: String,
    val dateStr: String,
    val snippet: String,
    val workdir: String
)

data class BoardTask(
    val id: String,
    val title: String,
    val agent: String,
    val status: String,
    val reviewBy: String,
    val reviewStatus: String
)
