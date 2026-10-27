package dev.herdr.agentdesk.network

import com.google.gson.Gson
import com.google.gson.JsonObject
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.io.IOException

data class PaneInfo(
    val pane_id: String,
    val agent: String?,
    val display_agent: String?,
    val agent_status: String?,
    val terminal_title_stripped: String?,
    val foreground_cwd: String?
)

data class SnapshotResponse(
    val status: String,
    val snapshot: JsonObject?
)

class AgentDeskClient(
    private val host: String = "100.77.2.5",
    private val port: Int = 9876,
    private val secret: String = ""
) {
    private val client = OkHttpClient.Builder().build()
    private val gson = Gson()
    private val baseUrl = "http://$host:$port"

    private fun getRequest(path: String): Request {
        val url = "$baseUrl$path${if (secret.isNotEmpty()) "?secret=$secret" else ""}"
        return Request.Builder()
            .url(url)
            .addHeader("Authorization", "Bearer $secret")
            .build()
    }

    fun fetchStatus(onSuccess: (JsonObject) -> Unit, onError: (String) -> Unit) {
        client.newCall(getRequest("/api/status")).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError(e.message ?: "Network error")
            }
            override fun onResponse(call: Call, response: Response) {
                if (!response.isSuccessful) {
                    onError("HTTP ${response.code}")
                    return
                }
                val body = response.body?.string() ?: "{}"
                val json = gson.fromJson(body, JsonObject::class.java)
                onSuccess(json.getAsJsonObject("snapshot") ?: JsonObject())
            }
        })
    }

    fun approvePane(paneId: String, onSuccess: () -> Unit, onError: (String) -> Unit) {
        val jsonBody = """{"pane_id": "$paneId"}"""
        val req = Request.Builder()
            .url("$baseUrl/api/approve${if (secret.isNotEmpty()) "?secret=$secret" else ""}")
            .addHeader("Authorization", "Bearer $secret")
            .post(jsonBody.toRequestBody("application/json".toMediaType()))
            .build()

        client.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError(e.message ?: "Failed to approve")
            }
            override fun onResponse(call: Call, response: Response) {
                if (response.isSuccessful) onSuccess() else onError("HTTP ${response.code}")
            }
        })
    }

    fun readTerminal(paneId: String, onSuccess: (String) -> Unit, onError: (String) -> Unit) {
        client.newCall(getRequest("/api/pane/$paneId/read?lines=80")).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError(e.message ?: "Error reading output")
            }
            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string() ?: "{}"
                val json = gson.fromJson(body, JsonObject::class.java)
                onSuccess(json.get("output")?.asString ?: "")
            }
        })
    }

    fun startEventStream(onEvent: (String, String) -> Unit): EventSource {
        val req = getRequest("/api/events")
        val factory = EventSources.createFactory(client)
        return factory.newEventSource(req, object : EventSourceListener() {
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                onEvent(type ?: "message", data)
            }
        })
    }
}
