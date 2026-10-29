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
    var secret: String = "63df263a-e1e4-4854-998c-7b1e8ce33dd4"
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
                // UI coroutine reconnect handles this
            }
        })
    }

    fun disconnect() {
        eventSource?.cancel()
        eventSource = null
    }

    suspend fun getStatus(): Pair<List<WorkspaceInfo>, List<PaneInfo>> = withContext(Dispatchers.IO) {
        val url = "$baseUrl/api/status${if (secret.isNotEmpty()) "?secret=$secret" else ""}"
        val request = Request.Builder().url(url).build()
        val response = client.newCall(request).execute()
        if (!response.isSuccessful) throw IOException("Unexpected code $response")

        val json = JSONObject(response.body?.string() ?: "{}")
        val snapshot = json.optJSONObject("snapshot") ?: JSONObject()

        val wsList = mutableListOf<WorkspaceInfo>()
        val workspacesJson = snapshot.optJSONArray("workspaces") ?: JSONArray()
        for (i in 0 until workspacesJson.length()) {
            val w = workspacesJson.getJSONObject(i)
            wsList.add(
                WorkspaceInfo(
                    name = w.optString("label", "Workspace"),
                    count = w.optInt("pane_count", 0)
                )
            )
        }

        val panesList = mutableListOf<PaneInfo>()
        val panesJson = snapshot.optJSONArray("panes") ?: JSONArray()
        for (i in 0 until panesJson.length()) {
            val p = panesJson.getJSONObject(i)
            panesList.add(
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
        Pair(wsList, panesList)
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

    suspend fun sendKeys(paneId: String, key: String): Boolean = withContext(Dispatchers.IO) {
        val url = "$baseUrl/api/keys${if (secret.isNotEmpty()) "?secret=$secret" else ""}"
        val body = JSONObject().put("pane_id", paneId).put("key", key).toString()
            .toRequestBody("application/json".toMediaType())
        val req = Request.Builder().url(url).post(body).build()
        val res = client.newCall(req).execute()
        res.isSuccessful
    }

    suspend fun readPane(paneId: String, lines: Int = 100): String = withContext(Dispatchers.IO) {
        val url = "$baseUrl/api/pane/$paneId/read?lines=$lines${if (secret.isNotEmpty()) "&secret=$secret" else ""}"
        val req = Request.Builder().url(url).build()
        val res = client.newCall(req).execute()
        val json = JSONObject(res.body?.string() ?: "{}")
        json.optString("output", "")
    }

    suspend fun getSessions(query: String = "", agent: String = ""): List<AgentSession> = withContext(Dispatchers.IO) {
        val params = mutableListOf<String>()
        if (query.isNotEmpty()) params.add("q=" + java.net.URLEncoder.encode(query, "UTF-8"))
        if (agent.isNotEmpty()) params.add("agent=" + java.net.URLEncoder.encode(agent, "UTF-8"))
        if (secret.isNotEmpty()) params.add("secret=" + java.net.URLEncoder.encode(secret, "UTF-8"))
        val qs = if (params.isNotEmpty()) "?" + params.joinToString("&") else ""
        val url = "$baseUrl/api/sessions$qs"

        val req = Request.Builder().url(url).build()
        val res = client.newCall(req).execute()
        if (!res.isSuccessful) return@withContext emptyList()

        val json = JSONObject(res.body?.string() ?: "{}")
        val arr = json.optJSONArray("sessions") ?: JSONArray()
        val list = mutableListOf<AgentSession>()
        for (i in 0 until arr.length()) {
            val s = arr.getJSONObject(i)
            list.add(
                AgentSession(
                    agent = s.optString("agent"),
                    cid = s.optString("cid"),
                    title = s.optString("title"),
                    dateStr = s.optString("dt_str"),
                    snippet = s.optString("snippet"),
                    workdir = s.optString("workdir"),
                    turns = s.optInt("step_count", 0)
                )
            )
        }
        list
    }

    suspend fun getBoard(): Pair<List<BoardTask>, List<FeedbackItem>> = withContext(Dispatchers.IO) {
        val url = "$baseUrl/api/board${if (secret.isNotEmpty()) "?secret=$secret" else ""}"
        val req = Request.Builder().url(url).build()
        val res = client.newCall(req).execute()
        if (!res.isSuccessful) return@withContext Pair(emptyList(), emptyList())

        val json = JSONObject(res.body?.string() ?: "{}")
        val board = json.optJSONObject("board") ?: JSONObject()

        val tasksList = mutableListOf<BoardTask>()
        val tasksArr = board.optJSONArray("tasks") ?: JSONArray()
        for (i in 0 until tasksArr.length()) {
            val t = tasksArr.getJSONObject(i)
            tasksList.add(
                BoardTask(
                    id = t.optString("id"),
                    title = t.optString("title"),
                    agent = t.optString("agent"),
                    status = t.optString("status"),
                    reviewBy = t.optString("review_by"),
                    reviewStatus = t.optString("review_status")
                )
            )
        }

        val fbList = mutableListOf<FeedbackItem>()
        val fbArr = board.optJSONArray("feedback") ?: JSONArray()
        for (i in 0 until fbArr.length()) {
            val f = fbArr.getJSONObject(i)
            fbList.add(
                FeedbackItem(
                    agent = f.optString("agent"),
                    timestamp = f.optString("timestamp"),
                    text = f.optString("text")
                )
            )
        }

        Pair(tasksList, fbList)
    }

    suspend fun updateTaskStatus(taskId: String, status: String): Boolean = withContext(Dispatchers.IO) {
        val url = "$baseUrl/api/board/task/status${if (secret.isNotEmpty()) "?secret=$secret" else ""}"
        val body = JSONObject().put("task_id", taskId).put("status", status).toString()
            .toRequestBody("application/json".toMediaType())
        val req = Request.Builder().url(url).post(body).build()
        val res = client.newCall(req).execute()
        res.isSuccessful
    }

    suspend fun killPane(paneId: String, force: Boolean = true): Boolean = withContext(Dispatchers.IO) {
        val url = "$baseUrl/api/pane/$paneId/kill${if (secret.isNotEmpty()) "?secret=$secret" else ""}"
        val body = JSONObject().put("force", force).toString()
            .toRequestBody("application/json".toMediaType())
        val req = Request.Builder().url(url).post(body).build()
        val res = client.newCall(req).execute()
        res.isSuccessful
    }

    suspend fun launchAgent(cwd: String, agent: String, label: String, prompt: String = ""): Boolean = withContext(Dispatchers.IO) {
        val url = "$baseUrl/api/agents/launch${if (secret.isNotEmpty()) "?secret=$secret" else ""}"
        val body = JSONObject()
            .put("cwd", cwd)
            .put("agent", agent)
            .put("label", label)
            .put("prompt", prompt)
            .toString()
            .toRequestBody("application/json".toMediaType())
        val req = Request.Builder().url(url).post(body).build()
        val res = client.newCall(req).execute()
        res.isSuccessful
    }

    suspend fun getWorkdirs(): List<WorkdirInfo> = withContext(Dispatchers.IO) {
        val url = "$baseUrl/api/workdirs${if (secret.isNotEmpty()) "?secret=$secret" else ""}"
        val req = Request.Builder().url(url).build()
        val res = client.newCall(req).execute()
        if (!res.isSuccessful) return@withContext emptyList()

        val json = JSONObject(res.body?.string() ?: "{}")
        val arr = json.optJSONArray("workdirs") ?: JSONArray()
        val list = mutableListOf<WorkdirInfo>()
        for (i in 0 until arr.length()) {
            val d = arr.getJSONObject(i)
            list.add(WorkdirInfo(name = d.optString("name"), path = d.optString("path")))
        }
        list
    }
}
