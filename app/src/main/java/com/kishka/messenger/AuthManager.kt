package com.kishka.messenger

import com.google.firebase.auth.FirebaseAuth

object AuthManager {

    private val auth: FirebaseAuth = FirebaseAuth.getInstance()

    /**
     * Реєстрація нового користувача та відправка листа з підтвердженням пошти.
     */
    fun registerUser(
        email: String,
        pass: String,
        onResult: (Boolean, String?) -> Unit
    ) {
        auth.createUserWithEmailAndPassword(email, pass)
            .addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    val user = auth.currentUser
                    user?.sendEmailVerification()
                        ?.addOnCompleteListener { sendTask ->
                            auth.signOut()
                            if (sendTask.isSuccessful) {
                                onResult(
                                    true,
                                    "На пошту $email надіслано лист для підтвердження. Будь ласка, підтвердіть пошту перед входом!"
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

    /**
     * Авторизація користувача з перевіркою верифікації Email.
     */
    fun loginUser(
        email: String,
        pass: String,
        onResult: (Boolean, String?) -> Unit
    ) {
        auth.signInWithEmailAndPassword(email, pass)
            .addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    val user = auth.currentUser
                    if (user != null && user.isEmailVerified) {
                        onResult(true, "Успішний вхід")
                    } else {
                        auth.signOut()
                        onResult(false, "Пошта не підтверджена! Перевірте скриньку $email")
                    }
                } else {
                    val errorCode = task.exception?.message ?: ""
                    if (errorCode.contains("no user record", ignoreCase = true) || 
                        errorCode.contains("user-not-found", ignoreCase = true)) {
                        registerUser(email, pass, onResult)
                    } else {
                        onResult(false, "Невірний пароль або пошта. Перевірте дані.")
                    }
                }
            }
    }

    /**
     * Повторна відправка листа верифікації.
     */
    fun resendVerificationEmail(
        email: String,
        pass: String,
        onResult: (Boolean, String?) -> Unit
    ) {
        auth.signInWithEmailAndPassword(email, pass)
            .addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    val user = auth.currentUser
                    user?.sendEmailVerification()
                        ?.addOnCompleteListener { sendTask ->
                            auth.signOut()
                            if (sendTask.isSuccessful) {
                                onResult(true, "Повторний лист верифікації надіслано на $email")
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
        return if (user != null && user.isEmailVerified) user.email else null
    }
}
