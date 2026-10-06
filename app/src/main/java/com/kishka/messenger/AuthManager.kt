package com.kishka.messenger

import com.google.firebase.auth.FirebaseAuth

object AuthManager {

    private val auth: FirebaseAuth = FirebaseAuth.getInstance()

    fun registerUser(
        email: String,
        pass: String,
        onResult: (Boolean, String?) -> Unit
    ) {
        val cleanEmail = email.trim().lowercase()
        auth.createUserWithEmailAndPassword(cleanEmail, pass)
            .addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    val user = auth.currentUser
                    user?.sendEmailVerification()
                        ?.addOnCompleteListener { sendTask ->
                            auth.signOut()
                            if (sendTask.isSuccessful) {
                                onResult(
                                    true,
                                    "На пошту $cleanEmail надіслано лист для підтвердження. Будь ласка, підтвердіть пошту!"
                                )
                            } else {
                                onResult(
                                    false,
                                    sendTask.exception?.message ?: "Не вдалося надіслати лист підтвердження"
                                )
                            }
                        } ?: run {
                            auth.signOut()
                            onResult(false, "Користувач відсутній")
                        }
                } else {
                    onResult(false, task.exception?.message ?: "Помилка реєстрації")
                }
            }
    }

    fun loginUser(
        email: String,
        pass: String,
        onResult: (Boolean, String?) -> Unit
    ) {
        val cleanEmail = email.trim().lowercase()
        auth.signInWithEmailAndPassword(cleanEmail, pass)
            .addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    val user = auth.currentUser
                    if (user != null && user.isEmailVerified) {
                        onResult(true, "Успішний вхід")
                    } else {
                        auth.signOut()
                        onResult(false, "Пошта не підтверджена! Перевірте скриньку $cleanEmail")
                    }
                } else {
                    val errorCode = task.exception?.message ?: ""
                    if (errorCode.contains("no user record", ignoreCase = true) || 
                        errorCode.contains("user-not-found", ignoreCase = true)) {
                        registerUser(cleanEmail, pass, onResult)
                    } else {
                        onResult(false, "Невірний пароль або пошта. Перевірте дані.")
                    }
                }
            }
    }

    fun resendVerificationEmail(
        email: String,
        pass: String,
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
                                onResult(true, "Повторний лист верифікації надіслано на $cleanEmail")
                            } else {
                                onResult(false, sendTask.exception?.message ?: "Помилка відправки листа")
                            }
                        } ?: run {
                            auth.signOut()
                            onResult(false, "Користувача не знайдено")
                        }
                } else {
                    onResult(false, task.exception?.message ?: "Не вдалося увійти для повторної відправки")
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
}
