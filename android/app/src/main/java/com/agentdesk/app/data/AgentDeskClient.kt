package com.agentdesk.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

class AgentDeskClient(
    var baseUrl: String = "http://100.77.2.5:9876",
    var secret: String = ""
) {
    private val client = OkHttpClient.Builder().build()
    private val sseClient = EventSources.createFactory(client)
    private var eventSource: EventSource? = null

    private val _events = MutableSharedFlow<String>(extraBufferCapacity = 64)
    val events: SharedFlow<String> = _events

    fun connectSSE() {
        val url = "$baseUrl/api/events${if (secret.isNotEmpty()) "?secret=$secret" else ""}"
        val request = Request.Builder()
            .url(url)
            .addHeader("Accept", "text/event-stream")
            .build()

        eventSource?.cancel()
        eventSource = sseClient.newEventSource(request, object : EventSourceListener() {
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                _events.tryEmit(data)
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                // Reconnect loop handled in UI/ViewModel
            }
        })
    }

    fun disconnect() {
        eventSource?.cancel()
        eventSource = null
    }

    suspend fun getStatus(): List<PaneInfo> = withContext(Dispatchers.IO) {
        val url = "$baseUrl/api/status${if (secret.isNotEmpty()) "?secret=$secret" else ""}"
        val request = Request.Builder().url(url).build()
        val response = client.newCall(request).execute()
        if (!response.isSuccessful) throw IOException("Unexpected code $response")

        val json = JSONObject(response.body?.string() ?: "{}")
        val snapshot = json.optJSONObject("snapshot") ?: JSONObject()
        val panesJson = snapshot.optJSONArray("panes") ?: JSONArray()

        val list = mutableListOf<PaneInfo>()
        for (i in 0 until panesJson.length()) {
            val p = panesJson.getJSONObject(i)
            list.add(
                PaneInfo(
                    paneId = p.optString("pane_id"),
                    agent = p.optString("agent").ifEmpty { p.optString("display_agent", "terminal") },
                    status = p.optString("agent_status", "idle"),
                    title = p.optString("terminal_title_stripped").ifEmpty { p.optString("terminal_title", "") },
                    workspace = p.optString("workspace_name"),
                    pid = p.optString("pid", null)
                )
            )
        }
        list
    }

    suspend fun approve(paneId: String): Boolean = withContext(Dispatchers.IO) {
        val url = "$baseUrl/api/approve${if (secret.isNotEmpty()) "?secret=$secret" else ""}"
        val body = JSONObject().put("pane_id", paneId).toString()
            .toRequestBody("application/json".toMediaType())
        val req = Request.Builder().url(url).post(body).build()
        val res = client.newCall(req).execute()
        res.isSuccessful
    }

    suspend fun sendInput(paneId: String, text: String, submit: Boolean = true): Boolean = withContext(Dispatchers.IO) {
        val url = "$baseUrl/api/interact${if (secret.isNotEmpty()) "?secret=$secret" else ""}"
        val body = JSONObject().put("pane_id", paneId).put("text", text).put("submit", submit).toString()
            .toRequestBody("application/json".toMediaType())
        val req = Request.Builder().url(url).post(body).build()
        val res = client.newCall(req).execute()
        res.isSuccessful
    }

    suspend fun readPane(paneId: String, lines: Int = 80): String = withContext(Dispatchers.IO) {
        val url = "$baseUrl/api/pane/$paneId/read?lines=$lines${if (secret.isNotEmpty()) "&secret=$secret" else ""}"
        val req = Request.Builder().url(url).build()
        val res = client.newCall(req).execute()
        val json = JSONObject(res.body?.string() ?: "{}")
        json.optString("output", "")
    }
}
