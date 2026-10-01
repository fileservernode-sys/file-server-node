package net.remotenode.fileserver.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Android Keystore-Protected Secure Storage Engine (Phase 14.5 / 14.5-R1)
 * SEC-14.1-05 Remediation: Encrypts all customer session tokens and sensitive metadata
 * at rest using AES-256-GCM with keys managed by the AndroidKeyStore provider.
 * Hardware-backed protection (TEE/StrongBox) is device-dependent based on hardware capabilities.
 */
object AndroidSecureStorage {

    private const val TAG = "ZdexSecureStorage"
    private const val ANDROID_KEY_STORE = "AndroidKeyStore"
    private const val MASTER_KEY_ALIAS = "zdexcloud_keystore_master_key"
    private const val AES_GCM_CIPHER = "AES/GCM/NoPadding"
    private const val GCM_TAG_LENGTH_BITS = 128
    private const val GCM_IV_LENGTH_BYTES = 12
    private const val ENCRYPTION_VERSION = 1

    private const val SESSION_ENCRYPTED_FILE = "rn_session.enc"
    private const val SESSION_LEGACY_PLAINTEXT_FILE = "rn_session.json"
    private const val SESSION_TMP_FILE = "rn_session.enc.tmp"

    private val lock = Any()

    /**
     * Retrieves or generates the 256-bit AES master key in AndroidKeyStore.
     */
    @Synchronized
    private fun getOrCreateSecretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }

        if (!keyStore.containsAlias(MASTER_KEY_ALIAS)) {
            val keyGenerator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                ANDROID_KEY_STORE
            )

            val builder = KeyGenParameterSpec.Builder(
                MASTER_KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)

            keyGenerator.init(builder.build())
            keyGenerator.generateKey()
            Log.i(TAG, "Initialized new 256-bit AES master key in AndroidKeyStore")
        }

        val keyEntry = keyStore.getEntry(MASTER_KEY_ALIAS, null) as? KeyStore.SecretKeyEntry
            ?: throw IllegalStateException("Failed to retrieve secret key entry from AndroidKeyStore")
        return keyEntry.secretKey
    }

    /**
     * Encrypts plaintext bytes using AES/GCM/NoPadding with the Keystore master key.
     * Output format: JSON envelope containing version, IV (Base64), and ciphertext+tag (Base64).
     */
    private fun encrypt(plaintext: ByteArray): String {
        val secretKey = getOrCreateSecretKey()
        val cipher = Cipher.getInstance(AES_GCM_CIPHER)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey)

        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plaintext)

        val envelope = JSONObject().apply {
            put("version", ENCRYPTION_VERSION)
            put("iv", Base64.encodeToString(iv, Base64.NO_WRAP))
            put("ciphertext", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
        }

        return envelope.toString()
    }

    /**
     * Decrypts an encrypted JSON envelope using AES/GCM/NoPadding with the Keystore master key.
     */
    private fun decrypt(encryptedEnvelopeJson: String): ByteArray {
        val envelope = JSONObject(encryptedEnvelopeJson)
        val version = envelope.getInt("version")
        if (version != ENCRYPTION_VERSION) {
            throw IllegalArgumentException("Unsupported encrypted payload version: $version")
        }

        val iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)
        val ciphertext = Base64.decode(envelope.getString("ciphertext"), Base64.NO_WRAP)

        val secretKey = getOrCreateSecretKey()
        val cipher = Cipher.getInstance(AES_GCM_CIPHER)
        val spec = GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv)
        cipher.init(Cipher.DECRYPT_MODE, secretKey, spec)

        return cipher.doFinal(ciphertext)
    }

    /**
     * Atomically writes encrypted data to target internal file.
     */
    private fun atomicWrite(targetFile: File, content: String) {
        val tmpFile = File(targetFile.parentFile, "${targetFile.name}.tmp")
        try {
            FileOutputStream(tmpFile).use { fos ->
                fos.write(content.toByteArray(StandardCharsets.UTF_8))
                fos.fd.sync()
            }
            if (targetFile.exists()) {
                targetFile.delete()
            }
            if (!tmpFile.renameTo(targetFile)) {
                // Fallback copy if rename fails
                tmpFile.copyTo(targetFile, overwrite = true)
                tmpFile.delete()
            }
        } catch (e: Exception) {
            tmpFile.delete()
            throw e
        }
    }

    /**
     * Saves customer authentication session securely in encrypted form.
     */
    fun saveSession(context: Context, sessionJson: String): Boolean {
        synchronized(lock) {
            return try {
                val encrypted = encrypt(sessionJson.toByteArray(StandardCharsets.UTF_8))
                val targetFile = File(context.filesDir, SESSION_ENCRYPTED_FILE)
                atomicWrite(targetFile, encrypted)

                // Clean up any legacy plaintext file if still present
                val legacyFile = File(context.filesDir, SESSION_LEGACY_PLAINTEXT_FILE)
                if (legacyFile.exists()) {
                    legacyFile.delete()
                }
                true
            } catch (e: Exception) {
                Log.e(TAG, "Failed to save encrypted session: ${e.javaClass.simpleName}")
                false
            }
        }
    }

    /**
     * Loads and decrypts the active customer authentication session.
     * Automatically migrates legacy plaintext rn_session.json if present.
     */
    fun getSession(context: Context): String? {
        synchronized(lock) {
            val encFile = File(context.filesDir, SESSION_ENCRYPTED_FILE)

            // 1. Primary path: Read encrypted session file
            if (encFile.exists() && encFile.length() > 0) {
                try {
                    val encryptedContent = FileInputStream(encFile).use { fis ->
                        fis.readBytes().toString(StandardCharsets.UTF_8)
                    }
                    val decryptedBytes = decrypt(encryptedContent)
                    return String(decryptedBytes, StandardCharsets.UTF_8)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to decrypt session file, failing closed: ${e.javaClass.simpleName}")
                    // Fail closed: discard corrupt/unusable session
                    encFile.delete()
                    return null
                }
            }

            // 2. Migration path: Check for legacy plaintext session file
            val legacyFile = File(context.filesDir, SESSION_LEGACY_PLAINTEXT_FILE)
            if (legacyFile.exists() && legacyFile.length() > 0) {
                try {
                    val rawContent = FileInputStream(legacyFile).use { fis ->
                        fis.readBytes().toString(StandardCharsets.UTF_8)
                    }
                    if (rawContent.trim().isNotEmpty()) {
                        // Validate JSON format
                        JSONObject(rawContent)

                        // Encrypt and write to new encrypted file
                        val encrypted = encrypt(rawContent.toByteArray(StandardCharsets.UTF_8))
                        atomicWrite(encFile, encrypted)

                        // Verify round-trip decryption
                        val verifyBytes = decrypt(encrypted)
                        if (verifyBytes.isNotEmpty()) {
                            // Safely remove legacy plaintext representation
                            legacyFile.delete()
                            Log.i(TAG, "Successfully migrated legacy plaintext session to Keystore encryption")
                            return rawContent
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to migrate legacy session: ${e.javaClass.simpleName}")
                }
            }

            return null
        }
    }

    /**
     * Clears all persisted session artifacts (encrypted, legacy, and temporary).
     */
    fun clearSession(context: Context): Boolean {
        synchronized(lock) {
            var success = true
            try {
                val encFile = File(context.filesDir, SESSION_ENCRYPTED_FILE)
                if (encFile.exists()) {
                    success = encFile.delete() && success
                }
                val legacyFile = File(context.filesDir, SESSION_LEGACY_PLAINTEXT_FILE)
                if (legacyFile.exists()) {
                    success = legacyFile.delete() && success
                }
                val tmpFile = File(context.filesDir, SESSION_TMP_FILE)
                if (tmpFile.exists()) {
                    tmpFile.delete()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error clearing session storage: ${e.javaClass.simpleName}")
                success = false
            }
            return success
        }
    }

    /**
     * Saves an encrypted key-value pair.
     */
    fun writeKv(context: Context, key: String, value: String): Boolean {
        synchronized(lock) {
            return try {
                val safeKey = key.replace(Regex("[^a-zA-Z0-9_\\-]"), "_")
                val encrypted = encrypt(value.toByteArray(StandardCharsets.UTF_8))
                val targetFile = File(context.filesDir, "rn_kv_$safeKey.enc")
                atomicWrite(targetFile, encrypted)
                true
            } catch (e: Exception) {
                Log.e(TAG, "Failed to write encrypted KV: ${e.javaClass.simpleName}")
                false
            }
        }
    }

    /**
     * Reads and decrypts an encrypted key-value pair.
     */
    fun readKv(context: Context, key: String): String? {
        synchronized(lock) {
            val safeKey = key.replace(Regex("[^a-zA-Z0-9_\\-]"), "_")
            val encFile = File(context.filesDir, "rn_kv_$safeKey.enc")
            if (encFile.exists() && encFile.length() > 0) {
                try {
                    val encryptedContent = FileInputStream(encFile).use { fis ->
                        fis.readBytes().toString(StandardCharsets.UTF_8)
                    }
                    val decryptedBytes = decrypt(encryptedContent)
                    return String(decryptedBytes, StandardCharsets.UTF_8)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to decrypt KV $safeKey: ${e.javaClass.simpleName}")
                    return null
                }
            }
            return null
        }
    }

    /**
     * Deletes an encrypted key-value pair.
     */
    fun deleteKv(context: Context, key: String): Boolean {
        synchronized(lock) {
            val safeKey = key.replace(Regex("[^a-zA-Z0-9_\\-]"), "_")
            val encFile = File(context.filesDir, "rn_kv_$safeKey.enc")
            return if (encFile.exists()) encFile.delete() else true
        }
    }
}
