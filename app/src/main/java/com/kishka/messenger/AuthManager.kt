package com.kishka.messenger

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException
import com.google.firebase.auth.FirebaseAuthInvalidUserException

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
                                    sendTask.exception?.localizedMessage ?: "Не вдалося надіслати лист підтвердження"
                                )
                            }
                        } ?: run {
                            auth.signOut()
                            onResult(false, "Користувач відсутній")
                        }
                } else {
                    val ex = task.exception
                    val msg = ex?.localizedMessage ?: ""
                    if (msg.contains("already in use", ignoreCase = true)) {
                        onResult(false, "Акаунт із такою поштою вже існує!")
                    } else {
                        onResult(false, "Помилка реєстрації. Перевірте пошту та пароль (мін. 6 символів).")
                    }
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
                    val ex = task.exception
                    val msg = ex?.localizedMessage ?: ""

                    if (ex is FirebaseAuthInvalidUserException || 
                        msg.contains("user-not-found", ignoreCase = true) || 
                        msg.contains("no user record", ignoreCase = true)) {
                        onResult(false, "Такого акаунта не існує! Спочатку зареєструйтеся.")
                    } else if (ex is FirebaseAuthInvalidCredentialsException || 
                               msg.contains("wrong-password", ignoreCase = true) || 
                               msg.contains("INVALID_LOGIN_CREDENTIALS", ignoreCase = true)) {
                        onResult(false, "Невірний пароль або пошта. Перевірте дані!")
                    } else {
                        onResult(false, "Не вдалося увійти. Перевірте введені дані.")
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
                                onResult(false, sendTask.exception?.localizedMessage ?: "Помилка відправки листа")
                            }
                        } ?: run {
                            auth.signOut()
                            onResult(false, "Користувача не знайдено")
                        }
                } else {
                    onResult(false, task.exception?.localizedMessage ?: "Не вдалося увійти для повторної відправки")
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
