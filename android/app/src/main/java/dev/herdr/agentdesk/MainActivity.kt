package dev.herdr.agentdesk

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import dev.herdr.agentdesk.network.AgentDeskClient
import dev.herdr.agentdesk.ui.AgentDeskApp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Default Tailscale IP for laptop
        val client = AgentDeskClient(
            host = "100.77.2.5",
            port = 9876,
            secret = "63df263a-e1e4-4854-998c-7b1e8ce33dd4"
        )
        setContent {
            AgentDeskApp(client = client)
        }
    }
}
