package com.gneiss.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Reading and writing an Obsidian vault the user picks, through the Storage
 * Access Framework.
 *
 * Capacitor's Filesystem plugin cannot do this. It works in ordinary file paths,
 * and since Android 11 an app cannot read a folder like `/storage/emulated/0/
 * Documents` without the all-files permission Google reserves for file managers.
 * The picker asks for one folder, the grant is persisted across reboots, and
 * nothing else on the device is reachable.
 *
 * This mirrors what `BrowserVaultSource` does with the File System Access API on
 * a laptop, so both platforms present the same "pick your vault once" model to
 * everything above `VaultSource`.
 */
@CapacitorPlugin(name = "VaultAccess")
class VaultAccessPlugin : Plugin() {

    /** Opens the system folder picker. Resolves with the tree URI to remember. */
    @PluginMethod
    fun pick(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            )
        }
        startActivityForResult(call, intent, "onFolderPicked")
    }

    @ActivityCallback
    private fun onFolderPicked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK) {
            call.reject("No folder chosen")
            return
        }

        val uri = result.data?.data
        if (uri == null) {
            call.reject("No folder chosen")
            return
        }

        // Without this the grant dies with the process, and the vault would have
        // to be picked again on every launch.
        context.contentResolver.takePersistableUriPermission(
            uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        )
        call.resolve(describe(uri))
    }

    /**
     * Whether a previously picked folder is still readable, so a saved vault can
     * be reopened silently on launch. A grant can be revoked, or the folder
     * removed, and neither is an error worth shouting about.
     */
    @PluginMethod
    fun reopen(call: PluginCall) {
        val uri = call.getString("uri")
        if (uri == null) {
            call.reject("A vault uri is required")
            return
        }

        val held = context.contentResolver.persistedUriPermissions.any {
            it.uri.toString() == uri && it.isReadPermission
        }
        call.resolve(if (held) describe(Uri.parse(uri)) else JSObject().put("available", false))
    }

    /**
     * Every markdown note under the vault, delivered in batches as the walk finds
     * them rather than in one payload at the end.
     *
     * A real vault on a phone takes long enough that a screen showing nothing
     * reads as a hang, so notes go out over the `vaultNotes` event while the walk
     * continues and the call resolves with the total once it is done.
     *
     * Batched, not one event per note: each hop across the bridge costs, and a
     * few hundred single-note events would spend more time crossing than reading.
     * The walk uses a cursor over `DocumentsContract` rather than `DocumentFile`,
     * which issues a query per entry and turns a large vault into a long wait.
     */
    @PluginMethod
    fun readNotes(call: PluginCall) {
        val tree = call.getString("uri")?.let(Uri::parse)
        if (tree == null) {
            call.reject("A vault uri is required")
            return
        }

        val batch = Batch()
        try {
            walk(tree, DocumentsContract.getTreeDocumentId(tree), "", batch)
            batch.flush()
        } catch (error: SecurityException) {
            call.reject("Access to that folder was withdrawn — pick it again", error)
            return
        }
        call.resolve(JSObject().put("total", batch.total))
    }

    /** Collects notes and sends them on in groups, so the screen fills as it reads. */
    private inner class Batch {
        var total = 0
            private set

        private var pending = JSArray()

        fun add(note: JSObject) {
            pending.put(note)
            total++
            if (pending.length() >= BATCH_SIZE) flush()
        }

        fun flush() {
            if (pending.length() == 0) return
            notifyListeners("vaultNotes", JSObject().put("notes", pending))
            pending = JSArray()
        }
    }

    /** One file by its path within the vault. Missing files resolve empty. */
    @PluginMethod
    fun readFile(call: PluginCall) {
        val tree = call.getString("uri")?.let(Uri::parse)
        val path = call.getString("path")
        if (tree == null || path == null) {
            call.reject("A vault uri and a path are required")
            return
        }

        val documentId = resolve(tree, path)
        val contents = documentId?.let { readText(tree, it) }
        call.resolve(JSObject().put("contents", contents ?: "").put("found", contents != null))
    }

    /** Writes one file, creating the folders above it when they do not exist. */
    @PluginMethod
    fun writeFile(call: PluginCall) {
        val tree = call.getString("uri")?.let(Uri::parse)
        val path = call.getString("path")
        val contents = call.getString("contents")
        if (tree == null || path == null || contents == null) {
            call.reject("A vault uri, a path and contents are required")
            return
        }

        try {
            write(tree, path, contents)
            call.resolve()
        } catch (error: SecurityException) {
            call.reject("That folder is read-only", error)
        }
    }

    // ——— The tree ———

    private fun walk(tree: Uri, documentId: String, prefix: String, into: Batch) {
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, documentId)
        val columns = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE
        )

        context.contentResolver.query(children, columns, null, null, null)?.use { cursor ->
            while (cursor.moveToNext()) {
                val childId = cursor.getString(0)
                val name = cursor.getString(1)
                val isDirectory = cursor.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR

                // `.obsidian` holds the plugin's own state and `.gneiss` holds
                // ours; neither is a note, and both are large.
                if (name.startsWith(".")) continue

                val path = if (prefix.isEmpty()) name else "$prefix/$name"
                if (isDirectory) {
                    walk(tree, childId, path, into)
                } else if (name.endsWith(MARKDOWN, ignoreCase = true)) {
                    into.add(JSObject().put("path", path).put("contents", readText(tree, childId)))
                }
            }
        }
    }

    /** The document id at `path`, resolved a segment at a time. */
    private fun resolve(tree: Uri, path: String): String? {
        var documentId = DocumentsContract.getTreeDocumentId(tree)
        for (segment in path.split("/").filter { it.isNotEmpty() }) {
            documentId = childNamed(tree, documentId, segment) ?: return null
        }
        return documentId
    }

    private fun childNamed(tree: Uri, parentId: String, name: String): String? {
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId)
        val columns = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME
        )

        context.contentResolver.query(children, columns, null, null, null)?.use { cursor ->
            while (cursor.moveToNext()) {
                if (cursor.getString(1) == name) return cursor.getString(0)
            }
        }
        return null
    }

    private fun readText(tree: Uri, documentId: String): String {
        val file = DocumentsContract.buildDocumentUriUsingTree(tree, documentId)
        return context.contentResolver.openInputStream(file)?.use {
            it.bufferedReader().readText()
        } ?: ""
    }

    private fun write(tree: Uri, path: String, contents: String) {
        val segments = path.split("/").filter { it.isNotEmpty() }
        val fileName = segments.last()
        var parentId = DocumentsContract.getTreeDocumentId(tree)

        for (folder in segments.dropLast(1)) {
            parentId = childNamed(tree, parentId, folder)
                ?: createChild(tree, parentId, DocumentsContract.Document.MIME_TYPE_DIR, folder)
        }

        val documentId = childNamed(tree, parentId, fileName)
            ?: createChild(tree, parentId, MARKDOWN_MIME, fileName)
        val file = DocumentsContract.buildDocumentUriUsingTree(tree, documentId)

        // "wt" truncates. Without it a shorter note leaves the tail of the longer
        // one it replaced, which would corrupt the file rather than rewrite it.
        context.contentResolver.openOutputStream(file, "wt")?.use {
            it.write(contents.toByteArray())
        }
    }

    private fun createChild(tree: Uri, parentId: String, mime: String, name: String): String {
        val parent = DocumentsContract.buildDocumentUriUsingTree(tree, parentId)
        val created = DocumentsContract.createDocument(context.contentResolver, parent, mime, name)
            ?: throw SecurityException("Could not create $name")
        return DocumentsContract.getDocumentId(created)
    }

    private fun describe(uri: Uri): JSObject =
        JSObject()
            .put("uri", uri.toString())
            .put("name", DocumentsContract.getTreeDocumentId(uri).substringAfterLast('/'))
            .put("available", true)

    private companion object {
        const val MARKDOWN = ".md"
        const val MARKDOWN_MIME = "text/markdown"

        /**
         * Notes per event. Small enough that the first cards appear almost at
         * once, large enough that the bridge is not the bottleneck.
         */
        const val BATCH_SIZE = 25
    }
}
