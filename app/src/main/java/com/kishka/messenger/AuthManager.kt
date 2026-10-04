package com.kishka.messenger

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser

object AuthManager {

    private val auth: FirebaseAuth = FirebaseAuth.getInstance()

    /**
     * 1. Реєстрація нового користувача та надсилання листа верифікації
     */
    fun registerUser(email: String, pass: String, onResult: (Boolean, String?) -> Unit) {
        if (email.isBlank() || pass.isBlank()) {
            onResult(false, "Заповніть усі поля")
            return
        }

        auth.createUserWithEmailAndPassword(email, pass)
            .addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    val user = auth.currentUser
                    // Відправляємо лист із посиланням для підтвердження
                    user?.sendEmailVerification()
                        .addOnCompleteListener { sendTask ->
                            if (sendTask.isSuccessful) {
                                // Виходимо з акаунта, поки користувач не перейде за посиланням у листі
                                auth.signOut()
                                onResult(true, "Лист із підтвердженням надіслано на $email. Будь ласка, перевірте пошту та перейдіть за посиланням!")
                            } else {
                                onResult(false, "Не вдалося надіслати лист: ${sendTask.exception?.message}")
                            }
                        }
                } else {
                    onResult(false, task.exception?.message ?: "Помилка реєстрації")
                }
            }
    }

    /**
     * 2. Вхід із перевіркою, чи підтвердив користувач пошту
     */
    fun loginUser(email: String, pass: String, onResult: (Boolean, String?) -> Unit) {
        if (email.isBlank() || pass.isBlank()) {
            onResult(false, "Заповніть усі поля")
            return
        }

        auth.signInWithEmailAndPassword(email, pass)
            .addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    val user = auth.currentUser
                    
                    // Ключовий момент: Оновлюємо дані користувача з сервера Firebase,
                    // щоб дізнатися актуальний статус isEmailVerified після переходу за посиланням
                    user?.reload()?.addOnCompleteListener { reloadTask ->
                        if (reloadTask.isSuccessful && user.isEmailVerified) {
                            onResult(true, "Успішний вхід!")
                        } else {
                            // Пошта ще не підтверджена
                            auth.signOut()
                            onResult(false, "Пошта ще не підтверджена! Перевірте скриньку $email та перейдіть за посиланням у листі.")
                        }
                    }
                } else {
                    onResult(false, task.exception?.message ?: "Помилка входу")
                }
            }
    }

    /**
     * 3. Повторна відправка листа верифікації
     */
    fun resendVerificationEmail(email: String, pass: String, onResult: (Boolean, String?) -> Unit) {
        auth.signInWithEmailAndPassword(email, pass)
            .addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    val user = auth.currentUser
                    user?.sendEmailVerification()
                        .addOnCompleteListener { sendTask ->
                            auth.signOut()
                            if (sendTask.isSuccessful) {
                                onResult(true, "Повторний лист верифікації надіслано на $email")
                            } else {
                                onResult(false, sendTask.exception?.message ?: "Помилка відправки листа")
                            }
                        }
                } else {
                    onResult(false, "Не вдалося авторизуватися для повторної відправки")
                }
            }
    }

    /**
     * Перевірка поточного стану користувача
     */
    fun isUserLoggedInAndVerified(): Boolean {
        val user = auth.currentUser
        return user != null && user.isEmailVerified
    }
}
