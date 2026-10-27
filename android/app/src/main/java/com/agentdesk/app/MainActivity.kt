package com.agentdesk.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.agentdesk.app.data.*
import com.agentdesk.app.ui.theme.*
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val client = AgentDeskClient()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AgentDeskTheme {
                AgentDeskApp(client)
            }
        }
    }
}

@Composable
fun AgentDeskApp(client: AgentDeskClient) {
    var workspaces by remember { mutableStateOf<List<WorkspaceInfo>>(emptyList()) }
    var panes by remember { mutableStateOf<List<PaneInfo>>(emptyList()) }
    var selectedWorkspaceFilter by remember { mutableStateOf<String?>(null) }
    var selectedPaneForPeek by remember { mutableStateOf<PaneInfo?>(null) }
    var terminalOutput by remember { mutableStateOf("") }
    var isConnected by remember { mutableStateOf(false) }
    var currentNavTab by remember { mutableStateOf(0) } // 0: Panes, 1: Sessions

    // Sessions tab state
    var searchQuery by remember { mutableStateOf("") }
    var selectedAgentFilter by remember { mutableStateOf("ALL") }
    var sessionsList by remember { mutableStateOf<List<AgentSession>>(emptyList()) }
    var selectedSessionDetail by remember { mutableStateOf<AgentSession?>(null) }

    var statusMessage by remember { mutableStateOf("") }
    val coroutineScope = rememberCoroutineScope()

    fun showToast(msg: String) {
        statusMessage = msg
        coroutineScope.launch {
            kotlinx.coroutines.delay(2500)
            if (statusMessage == msg) statusMessage = ""
        }
    }

    fun refreshPanes() {
        coroutineScope.launch {
            try {
                val (ws, p) = client.getStatus()
                workspaces = ws
                panes = p
                isConnected = true
            } catch (e: Exception) {
                isConnected = false
            }
        }
    }

    fun refreshSessions() {
        coroutineScope.launch {
            val agentArg = if (selectedAgentFilter == "ALL") "" else selectedAgentFilter.lowercase()
            sessionsList = client.getSessions(searchQuery, agentArg)
        }
    }

    LaunchedEffect(Unit) {
        refreshPanes()
        refreshSessions()
        client.connectSSE()
        client.events.collect {
            refreshPanes()
        }
    }

    LaunchedEffect(currentNavTab) {
        when (currentNavTab) {
            0 -> refreshPanes()
            else -> refreshSessions()
        }
    }

    val filteredPanes = remember(panes, selectedWorkspaceFilter) {
        if (selectedWorkspaceFilter == null) panes
        else panes.filter { it.workspace.equals(selectedWorkspaceFilter, ignoreCase = true) }
    }

    val blockedPane = panes.firstOrNull { it.status.equals("blocked", ignoreCase = true) }

    Scaffold(
        topBar = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(HerdrFrameHeader)
                    .border(width = 1.dp, color = HerdrBorder)
            ) {
                // Header Bar
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = ">_",
                            color = HerdrCyan,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "HERDR // agentdesk",
                            color = Color.White,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.ExtraBold,
                            fontSize = 14.sp,
                            letterSpacing = 1.sp
                        )
                    }

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(7.dp)
                                .background(
                                    if (isConnected) HerdrGreen else HerdrRed,
                                    shape = RoundedCornerShape(3.5.dp)
                                )
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = if (isConnected) "ONLINE" else "OFFLINE",
                            color = if (isConnected) HerdrGreen else HerdrRed,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            fontSize = 11.sp
                        )
                    }
                }

                // Workspace Terminal Tab Strip (when on Panes tab)
                if (currentNavTab == 0) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .padding(horizontal = 8.dp, vertical = 6.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        val isAllSelected = selectedWorkspaceFilter == null
                        Surface(
                            color = if (isAllSelected) Color(0xFF131924) else Color.Transparent,
                            shape = RoundedCornerShape(3.dp),
                            border = androidx.compose.foundation.BorderStroke(
                                1.dp,
                                if (isAllSelected) HerdrCyan else HerdrBorder
                            ),
                            modifier = Modifier.clickable { selectedWorkspaceFilter = null }
                        ) {
                            Text(
                                text = "[ ALL ${panes.size} ]",
                                color = if (isAllSelected) HerdrCyan else HerdrTextMuted,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                            )
                        }

                        workspaces.forEachIndexed { idx, ws ->
                            val isWsSelected = selectedWorkspaceFilter.equals(ws.name, ignoreCase = true)
                            Surface(
                                color = if (isWsSelected) Color(0xFF131924) else Color.Transparent,
                                shape = RoundedCornerShape(3.dp),
                                border = androidx.compose.foundation.BorderStroke(
                                    1.dp,
                                    if (isWsSelected) HerdrCyan else HerdrBorder
                                ),
                                modifier = Modifier.clickable { selectedWorkspaceFilter = ws.name }
                            ) {
                                Text(
                                    text = "[ ${idx + 1}: ${ws.name} ${ws.count} ]",
                                    color = if (isWsSelected) HerdrCyan else HerdrTextMuted,
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                                )
                            }
                        }
                    }
                }
            }
        },
        bottomBar = {
            // TUI Bottom Navigation Bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp)
                    .background(HerdrFrameHeader)
                    .border(width = 1.dp, color = HerdrBorder)
            ) {
                listOf(
                    Pair("⚡ 1:PANES", 0),
                    Pair("🔍 2:SESSIONS", 1)
                ).forEach { (label, idx) ->
                    val isSelected = currentNavTab == idx
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .background(if (isSelected) Color(0xFF1A2234) else Color.Transparent)
                            .clickable { currentNavTab = idx },
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = label,
                            color = if (isSelected) HerdrCyan else HerdrTextMuted,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            fontSize = 11.sp
                        )
                    }
                }
            }
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .background(HerdrBg)
        ) {
            when (currentNavTab) {
                0 -> PanesView(
                    panes = filteredPanes,
                    blockedPane = blockedPane,
                    onApprove = { paneId ->
                        coroutineScope.launch {
                            client.approve(paneId)
                            showToast("Approved (y) sent to pane #$paneId")
                            refreshPanes()
                        }
                    },
                    onAbort = { paneId ->
                        coroutineScope.launch {
                            client.sendKeys(paneId, "c")
                            showToast("Interrupt (^C) sent to pane #$paneId")
                            refreshPanes()
                        }
                    },
                    onPeek = { pane ->
                        selectedPaneForPeek = pane
                        coroutineScope.launch {
                            terminalOutput = client.readPane(pane.paneId)
                        }
                    },
                    onRefresh = { refreshPanes() }
                )

                else -> SessionsView(
                    sessions = sessionsList,
                    searchQuery = searchQuery,
                    onSearchChange = {
                        searchQuery = it
                        refreshSessions()
                    },
                    selectedAgent = selectedAgentFilter,
                    onAgentChange = {
                        selectedAgentFilter = it
                        refreshSessions()
                    },
                    onSelectSession = { selectedSessionDetail = it }
                )
            }

            // Status Toast
            if (statusMessage.isNotEmpty()) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 16.dp)
                        .background(HerdrFrameHeader, shape = RoundedCornerShape(4.dp))
                        .border(1.dp, HerdrCyan, shape = RoundedCornerShape(4.dp))
                        .padding(horizontal = 14.dp, vertical = 6.dp)
                ) {
                    Text(
                        text = "✓ $statusMessage",
                        color = HerdrCyan,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }
    }

    // Terminal Peek Bottom Sheet / Modal
    selectedPaneForPeek?.let { pane ->
        TerminalPeekDialog(
            pane = pane,
            output = terminalOutput,
            onClose = { selectedPaneForPeek = null },
            onSendKey = { key ->
                coroutineScope.launch {
                    client.sendKeys(pane.paneId, key)
                    showToast("Key '$key' sent")
                    terminalOutput = client.readPane(pane.paneId)
                }
            },
            onSendText = { text ->
                coroutineScope.launch {
                    client.sendInput(pane.paneId, text, submit = true)
                    showToast("Command sent")
                    terminalOutput = client.readPane(pane.paneId)
                }
            },
            onRefreshOutput = {
                coroutineScope.launch {
                    terminalOutput = client.readPane(pane.paneId)
                }
            }
        )
    }

    // Session Detail Modal
    selectedSessionDetail?.let { sess ->
        SessionDetailDialog(
            session = sess,
            onClose = { selectedSessionDetail = null }
        )
    }
}

@Composable
fun PanesView(
    panes: List<PaneInfo>,
    blockedPane: PaneInfo?,
    onApprove: (String) -> Unit,
    onAbort: (String) -> Unit,
    onPeek: (PaneInfo) -> Unit,
    onRefresh: () -> Unit
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Section Header
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "ACTIVE TERMINAL PANES",
                    color = HerdrTextMuted,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.5.sp
                )
                Surface(
                    color = Color.Transparent,
                    shape = RoundedCornerShape(3.dp),
                    border = androidx.compose.foundation.BorderStroke(1.dp, HerdrBorder),
                    modifier = Modifier.clickable { onRefresh() }
                ) {
                    Text(
                        text = "[ REFRESH ]",
                        color = HerdrCyan,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                    )
                }
            }
        }

        // Approval Banner if Blocked
        if (blockedPane != null) {
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFF281116), shape = RoundedCornerShape(4.dp))
                        .border(1.dp, HerdrRed, shape = RoundedCornerShape(4.dp))
                        .padding(12.dp)
                ) {
                    Text(
                        text = "┌─ ⚠ APPROVAL REQUIRED ──────────────────────",
                        color = HerdrRed,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "${blockedPane.agent} in pane #${blockedPane.paneId} requires confirmation.",
                        color = Color.White,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 12.sp
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { onApprove(blockedPane.paneId) },
                            colors = ButtonDefaults.buttonColors(containerColor = HerdrGreen),
                            shape = RoundedCornerShape(3.dp)
                        ) {
                            Text("> APPROVE (y)", color = Color.Black, fontFamily = FontFamily.Monospace, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                        Button(
                            onClick = { onAbort(blockedPane.paneId) },
                            colors = ButtonDefaults.buttonColors(containerColor = HerdrRed),
                            shape = RoundedCornerShape(3.dp)
                        ) {
                            Text("> REJECT (n)", color = Color.White, fontFamily = FontFamily.Monospace, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "└─────────────────────────────────────────────",
                        color = HerdrRed,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp
                    )
                }
            }
        }

        // Panes Items
        if (panes.isEmpty()) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(24.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "NO RUNNING PANES IN THIS WORKSPACE",
                        color = HerdrTextMuted,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 12.sp
                    )
                }
            }
        } else {
            items(panes) { pane ->
                HerdrTerminalCard(
                    pane = pane,
                    onApprove = { onApprove(pane.paneId) },
                    onAbort = { onAbort(pane.paneId) },
                    onPeek = { onPeek(pane) }
                )
            }
        }
    }
}

@Composable
fun HerdrTerminalCard(
    pane: PaneInfo,
    onApprove: () -> Unit,
    onAbort: () -> Unit,
    onPeek: () -> Unit
) {
    val statusColor = when (pane.status.lowercase()) {
        "working" -> HerdrGreen
        "blocked" -> HerdrRed
        else -> HerdrAmber
    }

    val statusDot = when (pane.status.lowercase()) {
        "working" -> "●"
        "blocked" -> "⚠"
        else -> "■"
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(HerdrFrame, shape = RoundedCornerShape(4.dp))
            .border(1.dp, HerdrBorder, shape = RoundedCornerShape(4.dp))
            .padding(12.dp)
    ) {
        // Frame Top Line
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "${pane.paneId} // ${pane.workspace}",
                color = HerdrCyan,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold,
                fontSize = 12.sp
            )

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "$statusDot ${pane.agent.uppercase()}: ${pane.status.uppercase()}",
                    color = statusColor,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    fontSize = 11.sp
                )
            }
        }

        Spacer(modifier = Modifier.height(6.dp))

        // Title & Path
        Text(
            text = pane.title.ifEmpty { "Pane #${pane.paneId}" },
            color = Color.White,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Medium,
            fontSize = 12.sp,
            maxLines = 1
        )
        Text(
            text = "cwd: ~/Work",
            color = HerdrTextMuted,
            fontFamily = FontFamily.Monospace,
            fontSize = 11.sp
        )

        Spacer(modifier = Modifier.height(10.dp))

        // Terminal Action Buttons
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Surface(
                color = Color.Transparent,
                shape = RoundedCornerShape(3.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, HerdrCyan),
                modifier = Modifier
                    .weight(1f)
                    .clickable { onPeek() }
            ) {
                Text(
                    text = "> PEEK",
                    color = HerdrCyan,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    fontSize = 11.sp,
                    modifier = Modifier.padding(vertical = 6.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                )
            }

            Surface(
                color = Color.Transparent,
                shape = RoundedCornerShape(3.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, HerdrGreen),
                modifier = Modifier
                    .weight(1.3f)
                    .clickable { onApprove() }
            ) {
                Text(
                    text = "> APPROVE (y)",
                    color = HerdrGreen,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    fontSize = 11.sp,
                    modifier = Modifier.padding(vertical = 6.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                )
            }

            Surface(
                color = Color.Transparent,
                shape = RoundedCornerShape(3.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, HerdrRed),
                modifier = Modifier
                    .weight(1.1f)
                    .clickable { onAbort() }
            ) {
                Text(
                    text = "> ABORT (^C)",
                    color = HerdrRed,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    fontSize = 11.sp,
                    modifier = Modifier.padding(vertical = 6.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                )
            }
        }
    }
}

@Composable
fun TerminalPeekDialog(
    pane: PaneInfo,
    output: String,
    onClose: () -> Unit,
    onSendKey: (String) -> Unit,
    onSendText: (String) -> Unit,
    onRefreshOutput: () -> Unit
) {
    var inputText by remember { mutableStateOf("") }
    val scrollState = rememberScrollState()

    AlertDialog(
        onDismissRequest = onClose,
        modifier = Modifier.fillMaxWidth(0.96f),
        properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false),
        confirmButton = {},
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF07090E), shape = RoundedCornerShape(4.dp))
                    .border(1.dp, HerdrCyan, shape = RoundedCornerShape(4.dp))
                    .padding(10.dp)
            ) {
                // Header
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "${pane.agent} // ${pane.paneId}",
                        color = HerdrCyan,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp
                    )
                    Surface(
                        color = Color.Transparent,
                        shape = RoundedCornerShape(3.dp),
                        border = androidx.compose.foundation.BorderStroke(1.dp, HerdrTextMuted),
                        modifier = Modifier.clickable { onClose() }
                    ) {
                        Text(
                            text = "[ ESC / CLOSE ]",
                            color = HerdrTextMuted,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 10.sp,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Terminal Stream Box
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(260.dp)
                        .background(Color(0xFF040608))
                        .border(1.dp, Color(0xFF1E2638))
                        .padding(8.dp)
                        .verticalScroll(scrollState)
                ) {
                    Text(
                        text = output.ifEmpty { "(no buffer stream available)" },
                        color = Color(0xFFE2E8F0),
                        fontFamily = FontFamily.Monospace,
                        fontSize = 10.5.sp,
                        lineHeight = 14.sp
                    )
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Tactile Macro Keypad
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    listOf(
                        Pair("y + ↵", "y"),
                        Pair("↵ Enter", "Enter"),
                        Pair("n", "n"),
                        Pair("^C Abort", "c"),
                        Pair("Esc", "Escape")
                    ).forEach { (label, key) ->
                        Surface(
                            color = Color(0xFF131924),
                            shape = RoundedCornerShape(3.dp),
                            border = androidx.compose.foundation.BorderStroke(1.dp, HerdrBorder),
                            modifier = Modifier.clickable { onSendKey(key) }
                        ) {
                            Text(
                                text = label,
                                color = HerdrText,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp)
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Command Input Line
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = ">",
                        color = HerdrCyan,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .background(Color(0xFF040608))
                            .border(1.dp, HerdrBorder, shape = RoundedCornerShape(3.dp))
                            .padding(horizontal = 8.dp, vertical = 6.dp)
                    ) {
                        BasicTextField(
                            value = inputText,
                            onValueChange = { inputText = it },
                            textStyle = TextStyle(
                                color = Color.White,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 12.sp
                            ),
                            cursorBrush = SolidColor(HerdrCyan),
                            modifier = Modifier.fillMaxWidth()
                        )
                        if (inputText.isEmpty()) {
                            Text(
                                text = "send prompt...",
                                color = HerdrTextMuted,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 11.sp
                            )
                        }
                    }
                    Spacer(modifier = Modifier.width(6.dp))
                    Surface(
                        color = HerdrCyan,
                        shape = RoundedCornerShape(3.dp),
                        modifier = Modifier.clickable {
                            if (inputText.isNotEmpty()) {
                                onSendText(inputText)
                                inputText = ""
                            }
                        }
                    ) {
                        Text(
                            text = "SEND",
                            color = Color.Black,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            fontSize = 11.sp,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                        )
                    }
                }
            }
        }
    )
}

@Composable
fun SessionsView(
    sessions: List<AgentSession>,
    searchQuery: String,
    onSearchChange: (String) -> Unit,
    selectedAgent: String,
    onAgentChange: (String) -> Unit,
    onSelectSession: (AgentSession) -> Unit
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item {
            Text(
                text = "CROSS-AGENT SESSIONS",
                color = HerdrTextMuted,
                fontFamily = FontFamily.Monospace,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold
            )
        }

        // Search Bar
        item {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF040608))
                    .border(1.dp, HerdrBorder, shape = RoundedCornerShape(3.dp))
                    .padding(horizontal = 10.dp, vertical = 8.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(">", color = HerdrCyan, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
                    Spacer(modifier = Modifier.width(6.dp))
                    BasicTextField(
                        value = searchQuery,
                        onValueChange = onSearchChange,
                        textStyle = TextStyle(
                            color = Color.White,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 12.sp
                        ),
                        cursorBrush = SolidColor(HerdrCyan),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                if (searchQuery.isEmpty()) {
                    Text(
                        text = "  search transcripts across agy, opencode…",
                        color = HerdrTextMuted,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp
                    )
                }
            }
        }

        // Agent Filter Chips
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                listOf("ALL", "AGY", "FREEBUFF", "OPENCODE", "GROK").forEach { agent ->
                    val isSel = selectedAgent.equals(agent, ignoreCase = true)
                    Surface(
                        color = if (isSel) Color(0xFF131924) else Color.Transparent,
                        shape = RoundedCornerShape(3.dp),
                        border = androidx.compose.foundation.BorderStroke(
                            1.dp,
                            if (isSel) HerdrCyan else HerdrBorder
                        ),
                        modifier = Modifier.clickable { onAgentChange(agent) }
                    ) {
                        Text(
                            text = agent,
                            color = if (isSel) HerdrCyan else HerdrTextMuted,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                        )
                    }
                }
            }
        }

        // Sessions List
        items(sessions) { sess ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(HerdrFrame, shape = RoundedCornerShape(4.dp))
                    .border(1.dp, HerdrBorder, shape = RoundedCornerShape(4.dp))
                    .clickable { onSelectSession(sess) }
                    .padding(10.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = "[ ${sess.agent.uppercase()} ]",
                        color = HerdrCyan,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "${sess.dateStr} • ${sess.turns} turns",
                        color = HerdrTextMuted,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 10.sp
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = sess.title.ifEmpty { "Untitled Session" },
                    color = Color.White,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    fontSize = 12.sp,
                    maxLines = 1
                )
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = sess.snippet,
                    color = HerdrTextMuted,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                    maxLines = 2
                )
            }
        }
    }
}

@Composable
fun SessionDetailDialog(
    session: AgentSession,
    onClose: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onClose,
        modifier = Modifier.fillMaxWidth(0.96f),
        confirmButton = {},
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF07090E), shape = RoundedCornerShape(4.dp))
                    .border(1.dp, HerdrCyan, shape = RoundedCornerShape(4.dp))
                    .padding(12.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "[ ${session.agent.uppercase()} SESSION ]",
                        color = HerdrCyan,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp
                    )
                    Surface(
                        color = Color.Transparent,
                        shape = RoundedCornerShape(3.dp),
                        border = androidx.compose.foundation.BorderStroke(1.dp, HerdrTextMuted),
                        modifier = Modifier.clickable { onClose() }
                    ) {
                        Text(
                            text = "[ CLOSE ]",
                            color = HerdrTextMuted,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 10.sp,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))
                Text(text = session.title, color = Color.White, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                Text(text = "cid: ${session.cid}", color = HerdrTextMuted, fontFamily = FontFamily.Monospace, fontSize = 10.sp)
                Text(text = "dir: ${session.workdir}", color = HerdrTextMuted, fontFamily = FontFamily.Monospace, fontSize = 10.sp)

                Spacer(modifier = Modifier.height(10.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(200.dp)
                        .background(Color(0xFF040608))
                        .border(1.dp, HerdrBorder)
                        .padding(8.dp)
                        .verticalScroll(rememberScrollState())
                ) {
                    Text(
                        text = session.snippet,
                        color = HerdrText,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp
                    )
                }
            }
        }
    )
}
