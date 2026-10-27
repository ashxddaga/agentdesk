package com.agentdesk.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.agentdesk.app.data.AgentDeskClient
import com.agentdesk.app.data.PaneInfo
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgentDeskApp(client: AgentDeskClient) {
    var panes by remember { mutableStateOf<List<PaneInfo>>(emptyList()) }
    var selectedPaneId by remember { mutableStateOf<String?>(null) }
    var terminalOutput by remember { mutableStateOf("") }
    var isConnected by remember { mutableStateOf(false) }
    var currentTab by remember { mutableStateOf(0) } // 0: Cockpit, 1: Sessions, 2: Board
    val coroutineScope = rememberCoroutineScope()

    fun refreshPanes() {
        coroutineScope.launch {
            try {
                panes = client.getStatus()
                isConnected = true
            } catch (e: Exception) {
                isConnected = false
            }
        }
    }

    LaunchedEffect(Unit) {
        refreshPanes()
        client.connectSSE()
        client.events.collect {
            refreshPanes()
        }
    }

    val blockedPane = panes.firstOrNull { it.status == "blocked" }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("AgentDesk", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                        Spacer(modifier = Modifier.width(8.dp))
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .background(
                                    if (isConnected) OkGreen else BadRed,
                                    shape = RoundedCornerShape(4.dp)
                                )
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = SurfaceDark,
                    titleContentColor = Color.White
                )
            )
        },
        bottomBar = {
            NavigationBar(containerColor = SurfaceDark) {
                NavigationBarItem(
                    selected = currentTab == 0,
                    onClick = { currentTab = 0 },
                    icon = { Icon(Icons.Default.Build, contentDescription = "Cockpit") },
                    label = { Text("Cockpit") }
                )
                NavigationBarItem(
                    selected = currentTab == 1,
                    onClick = { currentTab = 1 },
                    icon = { Icon(Icons.Default.List, contentDescription = "Sessions") },
                    label = { Text("Sessions") }
                )
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .background(BgDark)
        ) {
            // Approval Banner
            if (blockedPane != null) {
                Surface(
                    color = BadRed.copy(alpha = 0.2f),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                            Icon(Icons.Default.Warning, contentDescription = "Blocked", tint = BadRed)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = "${blockedPane.agent} needs approval!",
                                color = Color.White,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                        Button(
                            onClick = {
                                coroutineScope.launch {
                                    client.approve(blockedPane.paneId)
                                    refreshPanes()
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = OkGreen),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Text("Approve", color = Color.White, fontSize = 12.sp)
                        }
                    }
                }
            }

            // Pane Cards
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(panes) { pane ->
                    PaneCard(
                        pane = pane,
                        onApprove = {
                            coroutineScope.launch {
                                client.approve(pane.paneId)
                                refreshPanes()
                            }
                        },
                        onPeek = {
                            coroutineScope.launch {
                                selectedPaneId = pane.paneId
                                terminalOutput = client.readPane(pane.paneId)
                            }
                        }
                    )
                }
            }
        }
    }

    // Terminal Peek Bottom Sheet Dialog
    if (selectedPaneId != null) {
        AlertDialog(
            onDismissRequest = { selectedPaneId = null },
            confirmButton = {
                TextButton(onClick = { selectedPaneId = null }) {
                    Text("Close")
                }
            },
            title = { Text("Terminal - Pane #$selectedPaneId") },
            text = {
                Surface(
                    color = Color.Black,
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(300.dp)
                        .padding(4.dp)
                ) {
                    Text(
                        text = terminalOutput.ifEmpty { "(no output)" },
                        color = Color(0xFFD1D5DB),
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        modifier = Modifier.padding(8.dp)
                    )
                }
            }
        )
    }
}

@Composable
fun PaneCard(
    pane: PaneInfo,
    onApprove: () -> Unit,
    onPeek: () -> Unit
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = SurfaceDark),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Surface(
                    color = AccentBlue.copy(alpha = 0.15f),
                    shape = RoundedCornerShape(6.dp)
                ) {
                    Text(
                        text = "⚡ ${pane.agent}",
                        color = AccentBlue,
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp,
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                    )
                }

                val statusColor = when (pane.status) {
                    "working" -> OkGreen
                    "blocked" -> BadRed
                    else -> WarnAmber
                }
                Surface(
                    color = statusColor.copy(alpha = 0.15f),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text(
                        text = pane.status,
                        color = statusColor,
                        fontWeight = FontWeight.Bold,
                        fontSize = 11.sp,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp)
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = pane.title.ifEmpty { "Pane #${pane.paneId}" },
                fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp,
                color = Color.White
            )

            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "#${pane.paneId}  •  ${pane.workspace}",
                fontSize = 12.sp,
                color = Color.Gray,
                fontFamily = FontFamily.Monospace
            )

            Spacer(modifier = Modifier.height(12.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(
                    onClick = onPeek,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text("Peek", fontSize = 12.sp)
                }
                Button(
                    onClick = onApprove,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = OkGreen),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text("Approve (y)", fontSize = 12.sp, color = Color.White)
                }
            }
        }
    }
}
