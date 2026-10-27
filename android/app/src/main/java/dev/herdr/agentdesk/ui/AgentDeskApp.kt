package dev.herdr.agentdesk.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import dev.herdr.agentdesk.network.AgentDeskClient

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgentDeskApp(client: AgentDeskClient) {
    var snapshot by remember { mutableStateOf<JsonObject?>(null) }
    var blockedPaneId by remember { mutableStateOf<String?>(null) }
    var selectedTerminalOutput by remember { mutableStateOf<String?>(null) }
    var selectedPaneId by remember { mutableStateOf<String?>(null) }

    // Fetch initial status
    LaunchedEffect(Unit) {
        client.fetchStatus(
            onSuccess = { snap ->
                snapshot = snap
                val panes = snap.getAsJsonArray("panes") ?: JsonArray()
                val blocked = panes.firstOrNull {
                    it.asJsonObject.get("agent_status")?.asString == "blocked"
                }
                blockedPaneId = blocked?.asJsonObject?.get("pane_id")?.asString
            },
            onError = { /* fallback */ }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("AgentDesk", fontWeight = FontWeight.Bold, fontSize = 18.sp) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color(0xFF12161F),
                    titleContentColor = Color(0xFFF0F6FC)
                )
            )
        },
        containerColor = Color(0xFF090C10)
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp, vertical = 12.dp)
        ) {
            // Attention / Approval Banner
            blockedPaneId?.let { pid ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 14.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF991B1B)),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Column(modifier = Modifier.padding(14.dp)) {
                        Text(
                            "⚠️ Agent needs approval in $pid",
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp
                        )
                        Spacer(modifier = Modifier.height(10.dp))
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = {
                                    client.approvePane(pid, { blockedPaneId = null }, {})
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF22C55E)),
                                modifier = Modifier.weight(2f)
                            ) {
                                Text("Approve (y)", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }

            // Section Title
            Text(
                "LIVE AGENTS & PANES",
                color = Color(0xFF8B949E),
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(bottom = 10.dp)
            )

            // Panes List
            val panes = snapshot?.getAsJsonArray("panes") ?: JsonArray()
            if (panes.size() == 0) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 40.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text("No active terminal panes running.", color = Color(0xFF8B949E))
                }
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(panes.toList()) { element ->
                        val p = element.asJsonObject
                        val pid = p.get("pane_id")?.asString ?: ""
                        val agent = p.get("agent")?.asString ?: p.get("display_agent")?.asString ?: "agent"
                        val status = p.get("agent_status")?.asString ?: "unknown"
                        val title = p.get("terminal_title_stripped")?.asString
                            ?: p.get("terminal_title")?.asString ?: "Pane $pid"
                        val cwd = p.get("foreground_cwd")?.asString ?: p.get("cwd")?.asString ?: "~"

                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    selectedPaneId = pid
                                    client.readTerminal(pid, { selectedTerminalOutput = it }, {})
                                },
                            colors = CardDefaults.cardColors(containerColor = Color(0xFF12161F)),
                            shape = RoundedCornerShape(16.dp)
                        ) {
                            Column(modifier = Modifier.padding(14.dp)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        "[$agent]",
                                        color = Color(0xFF60A5FA),
                                        fontFamily = FontFamily.Monospace,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 12.sp
                                    )
                                    val (badgeBg, badgeColor) = when (status) {
                                        "working" -> Color(0xFF14532D) to Color(0xFF4ADE80)
                                        "blocked" -> Color(0xFF7F1D1D) to Color(0xFFF87171)
                                        else -> Color(0xFF78350F) to Color(0xFFFBBF24)
                                    }
                                    Box(
                                        modifier = Modifier
                                            .background(badgeBg, RoundedCornerShape(999.dp))
                                            .padding(horizontal = 10.dp, vertical = 4.dp)
                                    ) {
                                        Text(status, color = badgeColor, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                    }
                                }
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(title, color = Color(0xFFF0F6FC), fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                                Spacer(modifier = Modifier.height(4.dp))
                                Text("Dir: ${cwd.replace("/home/ashish", "~")}", color = Color(0xFF8B949E), fontSize = 11.sp)
                            }
                        }
                    }
                }
            }
        }
    }

    // Terminal Peek Dialog
    selectedTerminalOutput?.let { output ->
        AlertDialog(
            onDismissRequest = { selectedTerminalOutput = null },
            confirmButton = {
                TextButton(onClick = { selectedTerminalOutput = null }) {
                    Text("Close", color = Color(0xFF60A5FA))
                }
            },
            title = { Text("Output: $selectedPaneId", fontSize = 14.sp, fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    output.takeLast(1500),
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                    color = Color(0xFFD1D5DB)
                )
            },
            containerColor = Color(0xFF12161F)
        )
    }
}
