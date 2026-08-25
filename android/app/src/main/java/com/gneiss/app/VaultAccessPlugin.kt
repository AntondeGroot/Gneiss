package com.gneiss.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Base64
import java.util.concurrent.Executors
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

        val found = mutableListOf<Note>()
        val attachments = JSObject()
        try {
            list(tree, DocumentsContract.getTreeDocumentId(tree), "", found, attachments)
            // Sent before a single note is read. Listing is cursor queries and takes
            // about a second; reading the notes takes far longer, and a card shown
            // in between would otherwise look for its image in an index that does
            // not exist yet and fall back to showing the raw link.
            notifyListeners("vaultAttachments", JSObject().put("attachments", attachments))
            readAll(tree, found)
        } catch (error: SecurityException) {
            call.reject("Access to that folder was withdrawn — pick it again", error)
            return
        }
        call.resolve(JSObject().put("total", found.size).put("attachments", attachments))
    }

    private data class Note(val documentId: String, val path: String)

    /**
     * Reads the notes a batch at a time, several at once, sending each batch on
     * as it completes.
     *
     * Opening a document through the Storage Access Framework costs far more
     * than the bytes justify — measured at roughly 29ms a file, which is half a
     * minute for a vault of 938 notes read one after another. The work is
     * waiting, not computing, so reading a batch in parallel turns almost all of
     * that into overlap. Batches still go out in order, so the screen fills the
     * same way.
     */
    private fun readAll(tree: Uri, notes: List<Note>) {
        if (notes.isEmpty()) return

        val readers = Executors.newFixedThreadPool(READERS)
        try {
            for (batch in notes.chunked(BATCH_SIZE)) {
                val pending = batch.map { note ->
                    readers.submit<JSObject> {
                        JSObject().put("path", note.path).put("contents", readText(tree, note.documentId))
                    }
                }

                val read = JSArray()
                for (task in pending) read.put(task.get())
                notifyListeners("vaultNotes", JSObject().put("notes", read))
            }
        } finally {
            readers.shutdown()
        }
    }

    /**
     * One attachment, as a data URL the webview can put in an `img` tag.
     *
     * Base64 rather than a file path: the vault is reached through a content URI,
     * which `Capacitor.convertFileSrc` cannot turn into something loadable. Read
     * on demand, one card at a time, so a vault full of screenshots is never
     * pulled through the bridge at once.
     */
    @PluginMethod
    fun readAttachment(call: PluginCall) {
        val tree = call.getString("uri")?.let(Uri::parse)
        val path = call.getString("path")
        if (tree == null || path == null) {
            call.reject("A vault uri and a path are required")
            return
        }

        val documentId = resolve(tree, path)
        if (documentId == null) {
            call.resolve(JSObject().put("dataUrl", "").put("found", false))
            return
        }

        val file = DocumentsContract.buildDocumentUriUsingTree(tree, documentId)
        val bytes = context.contentResolver.openInputStream(file)?.use { it.readBytes() }
        if (bytes == null) {
            call.resolve(JSObject().put("dataUrl", "").put("found", false))
            return
        }

        val mime = sniff(bytes) ?: context.contentResolver.getType(file) ?: FALLBACK_MIME
        val encoded = Base64.encodeToString(bytes, Base64.NO_WRAP)
        call.resolve(JSObject().put("dataUrl", "data:$mime;base64,$encoded").put("found", true))
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

    /**
     * Removes one file from the vault.
     *
     * Only ever used to clear away a sync tool's conflicted copy once it has
     * been merged into the note it came from. Resolves `deleted: false` rather
     * than failing when the file is already gone, since the caller's goal — that
     * it not be there — has been met either way.
     */
    @PluginMethod
    fun deleteFile(call: PluginCall) {
        val tree = call.getString("uri")?.let(Uri::parse)
        val path = call.getString("path")
        if (tree == null || path == null) {
            call.reject("A vault uri and a path are required")
            return
        }

        try {
            call.resolve(JSObject().put("deleted", delete(tree, path)))
        } catch (error: SecurityException) {
            call.reject("That folder is read-only", error)
        }
    }

    // ——— The tree ———

    /**
     * Names every note and attachment, without reading any of them.
     *
     * Listing is one cursor query per folder and cheap; reading is the expensive
     * part, so it is left to `readAll` where it can be done several at a time.
     */
    private fun list(
        tree: Uri,
        documentId: String,
        prefix: String,
        notes: MutableList<Note>,
        attachments: JSObject
    ) {
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
                    list(tree, childId, path, notes, attachments)
                } else if (name.endsWith(MARKDOWN, ignoreCase = true)) {
                    notes.add(Note(childId, path))
                } else {
                    // Everything that is not a note is a possible attachment, indexed
                    // by name because `![[diagram.png]]` says what to show without
                    // saying where it lives. Names only — the bytes are read when a
                    // card actually asks for them, not now.
                    attachments.put(name, path)
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

    private fun delete(tree: Uri, path: String): Boolean {
        val documentId = documentIdFor(tree, path) ?: return false
        val file = DocumentsContract.buildDocumentUriUsingTree(tree, documentId)
        return DocumentsContract.deleteDocument(context.contentResolver, file)
    }

    /** Walks an existing path, creating nothing — unlike `write`, which does. */
    private fun documentIdFor(tree: Uri, path: String): String? {
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

    /**
     * The image type from the file's own first bytes.
     *
     * Trusted over the name because names lie: an image pasted as `.pgn` is one
     * keystroke from `.png` and still a picture, and the provider would report
     * it as an unknown type the webview then refuses to draw. Every format here
     * is identified by a fixed signature, so this is a comparison, not a guess.
     */
    private fun sniff(bytes: ByteArray): String? {
        fun startsWith(vararg signature: Int): Boolean =
            bytes.size >= signature.size &&
                signature.withIndex().all { (at, byte) -> bytes[at] == byte.toByte() }

        return when {
            startsWith(0x89, 0x50, 0x4E, 0x47) -> "image/png"
            startsWith(0xFF, 0xD8, 0xFF) -> "image/jpeg"
            startsWith(0x47, 0x49, 0x46) -> "image/gif"
            startsWith(0x42, 0x4D) -> "image/bmp"
            // RIFF....WEBP — the tag sits after the four-byte length.
            startsWith(0x52, 0x49, 0x46, 0x46) && bytes.size > 11 &&
                String(bytes, 8, 4, Charsets.US_ASCII) == "WEBP" -> "image/webp"
            looksLikeSvg(bytes) -> "image/svg+xml"
            else -> null
        }
    }

    /** SVG is text, so it is recognised by what it opens with rather than a signature. */
    private fun looksLikeSvg(bytes: ByteArray): Boolean {
        val head = String(bytes, 0, minOf(bytes.size, 200), Charsets.US_ASCII).trimStart()
        return head.startsWith("<svg") || head.startsWith("<?xml")
    }

    private fun describe(uri: Uri): JSObject =
        JSObject()
            .put("uri", uri.toString())
            .put("name", DocumentsContract.getTreeDocumentId(uri).substringAfterLast('/'))
            .put("available", true)

    private companion object {
        const val MARKDOWN = ".md"
        const val MARKDOWN_MIME = "text/markdown"
        const val FALLBACK_MIME = "application/octet-stream"

        /**
         * Notes per event. Small enough that the first cards appear almost at
         * once, large enough that the bridge is not the bottleneck.
         */
        const val BATCH_SIZE = 25

        /**
         * Files read at once. The work is waiting on the document provider
         * rather than on the CPU, so this is well above the core count.
         */
        const val READERS = 8
    }
}
