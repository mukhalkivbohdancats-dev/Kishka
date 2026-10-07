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
                                    "На пошту $cleanEmail надіслано лист для підтвердження. Підтвердіть її!"
                                )
                            } else {
                                onResult(
                                    false,
                                    sendTask.exception?.localizedMessage ?: "Не вдалося надіслати лист підтвердження"
                                )
                            }
                        } ?: run {
                            auth.signOut()
                            onResult(false, "Помилка створення акаунта.")
                        }
                } else {
                    val err = task.exception?.localizedMessage ?: ""
                    if (err.contains("already in use", ignoreCase = true)) {
                        onResult(false, "Акаунт із такою поштою вже існує!")
                    } else {
                        onResult(false, "Некоректний формат пошти або слабкий пароль.")
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
                    val errorCode = task.exception?.localizedMessage ?: ""
                    if (errorCode.contains("no user record", ignoreCase = true) || 
                        errorCode.contains("user-not-found", ignoreCase = true) ||
                        errorCode.contains("INVALID_LOGIN_CREDENTIALS", ignoreCase = true)) {
                        onResult(false, "Такого акаунта не існує! Перевірте введений email.")
                    } else if (errorCode.contains("wrong-password", ignoreCase = true) || errorCode.contains("invalid-password", ignoreCase = true)) {
                        onResult(false, "Неправильний пароль!")
                    } else {
                        onResult(false, "Невірний пароль або акаунт відсутній.")
                    }
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
