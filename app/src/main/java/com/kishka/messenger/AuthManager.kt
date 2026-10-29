package com.kishka.messenger

import android.content.Context
import android.content.SharedPreferences
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException
import com.google.firebase.auth.FirebaseAuthInvalidUserException
import com.google.firebase.auth.UserProfileChangeRequest

object AuthManager {

    private val auth: FirebaseAuth = FirebaseAuth.getInstance()
    private const val PREFS_NAME = "kishka_prefs"
    private const val KEY_LANG = "saved_language"

    /** Код останньої помилки входу ("unverified", "no_account", "wrong", "other") — для підказок в інтерфейсі. */
    @Volatile var lastErrorCode: String = ""

    private fun t(key: String, lang: String): String = AppText.get(key, lang)
    private fun t(key: String, lang: String, arg: String): String = String.format(AppText.get(key, lang), arg)

    private fun getPrefs(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun saveLanguage(context: Context, lang: String) {
        getPrefs(context).edit().putString(KEY_LANG, lang).apply()
    }

    fun getSavedLanguage(context: Context): String {
        return getPrefs(context).getString(KEY_LANG, "uk") ?: "uk"
    }

    fun registerUser(
        email: String,
        pass: String,
        displayName: String,
        lang: String = "uk",
        onResult: (Boolean, String?) -> Unit
    ) {
        val cleanEmail = email.trim().lowercase()
        val cleanName = displayName.trim().ifEmpty { cleanEmail.substringBefore("@") }

        auth.createUserWithEmailAndPassword(cleanEmail, pass)
            .addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    val user = auth.currentUser
                    val profileUpdates = UserProfileChangeRequest.Builder()
                        .setDisplayName(cleanName)
                        .build()

                    user?.updateProfile(profileUpdates)?.addOnCompleteListener {
                        user.sendEmailVerification()
                            .addOnCompleteListener { sendTask ->
                                auth.signOut()
                                if (sendTask.isSuccessful) {
                                    onResult(
                                        true,
                                        t("auth_confirm_sent", lang, cleanEmail)
                                    )
                                } else {
                                    onResult(
                                        false,
                                        sendTask.exception?.localizedMessage ?: t("auth_send_failed", lang)
                                    )
                                }
                            }
                    } ?: run {
                        auth.signOut()
                        onResult(false, t("auth_create_failed", lang))
                    }
                } else {
                    val ex = task.exception
                    val msg = ex?.localizedMessage ?: ""
                    if (msg.contains("already in use", ignoreCase = true)) {
                        onResult(false, t("auth_exists", lang))
                    } else {
                        onResult(false, t("auth_reg_failed", lang))
                    }
                }
            }
    }

    fun loginUser(
        email: String,
        pass: String,
        lang: String = "uk",
        onResult: (Boolean, String?) -> Unit
    ) {
        lastErrorCode = ""
        val cleanEmail = email.trim().lowercase()
        auth.signInWithEmailAndPassword(cleanEmail, pass)
            .addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    val user = auth.currentUser
                    if (user != null && user.isEmailVerified) {
                        onResult(true, t("auth_login_ok", lang))
                    } else {
                        auth.signOut()
                        lastErrorCode = "unverified"
                        onResult(false, t("auth_unverified", lang, cleanEmail))
                    }
                } else {
                    val ex = task.exception
                    val msg = ex?.localizedMessage ?: ""

                    if (ex is FirebaseAuthInvalidUserException || 
                        msg.contains("user-not-found", ignoreCase = true) || 
                        msg.contains("no user record", ignoreCase = true)) {
                        lastErrorCode = "no_account"
                        onResult(false, t("auth_no_account", lang))
                    } else if (ex is FirebaseAuthInvalidCredentialsException || 
                               msg.contains("wrong-password", ignoreCase = true) || 
                               msg.contains("INVALID_LOGIN_CREDENTIALS", ignoreCase = true)) {
                        lastErrorCode = "wrong"
                        onResult(false, t("auth_wrong", lang))
                    } else {
                        lastErrorCode = "other"
                        onResult(false, t("auth_login_failed", lang))
                    }
                }
            }
    }

    fun resendVerificationEmail(
        email: String,
        pass: String,
        lang: String = "uk",
        onResult: (Boolean, String?) -> Unit
    ) {
        val cleanEmail = email.trim().lowercase()
        auth.signInWithEmailAndPassword(cleanEmail, pass)
            .addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    val user = auth.currentUser
                    user?.sendEmailVerification()
                        ?.addOnCompleteListener { sendTask ->
                            auth.signOut()
                            if (sendTask.isSuccessful) {
                                onResult(true, t("auth_resend_ok", lang, cleanEmail))
                            } else {
                                onResult(false, sendTask.exception?.localizedMessage ?: t("auth_resend_failed", lang))
                            }
                        } ?: run {
                            auth.signOut()
                            onResult(false, t("auth_user_missing", lang))
                        }
                } else {
                    onResult(false, task.exception?.localizedMessage ?: t("auth_resend_login_failed", lang))
                }
            }
    }

    fun isUserLoggedInAndVerified(): Boolean {
        val user = auth.currentUser
        return user != null && user.isEmailVerified
    }

    fun getCurrentUserEmail(): String? {
        val user = auth.currentUser
        return if (user != null && user.isEmailVerified) user.email?.lowercase() else null
    }

    fun getCurrentUserDisplayName(): String {
        val user = auth.currentUser
        return user?.displayName ?: user?.email?.substringBefore("@") ?: ""
    }

    fun getCurrentUserPhotoUrl(): String? {
        val user = auth.currentUser
        return user?.photoUrl?.toString()
    }
}
